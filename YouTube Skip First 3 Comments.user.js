
// ==UserScript==
// @name         YouTube Skip First 3 Comments
// @namespace    local
// @version      1.1.3
// @description  Hide first 3 comments; count is official total minus 3 and updates live
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SKIP = 3;
  const SHOW_BOX = true;
  const BOX_ID = 'yt-skip3-box';
  const STYLE_ID = 'yt-skip3-style';

  if (window.trustedTypes && trustedTypes.createPolicy) {
    try {
      trustedTypes.createPolicy('default', {
        createHTML: (s) => s,
        createScriptURL: (s) => s,
        createScript: (s) => s,
      });
    } catch (_) {}
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      ytd-comments #contents > ytd-comment-thread-renderer:nth-of-type(-n+${SKIP}),
      #comments ytd-item-section-renderer #contents > ytd-comment-thread-renderer:nth-of-type(-n+${SKIP}) {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      ytd-comments-header-renderer #count yt-formatted-string:not([data-skip3-shown]),
      ytd-comments-header-renderer .count-text:not([data-skip3-shown]),
      ytd-comments-header-renderer h2#count:not([data-skip3-shown]),
      ytd-comments-header-renderer #count:not([data-skip3-shown]),
      #count.ytd-comments-header-renderer yt-formatted-string:not([data-skip3-shown]) {
        visibility: hidden !important;
      }
      #${BOX_ID} {
        position: fixed !important;
        left: 16px !important;
        bottom: 16px !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        display: block !important;
        min-width: 200px;
        max-width: 340px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(0,0,0,0.45) !important;
        border: 1px solid rgba(255,255,255,0.3);
        color: #fff !important;
        font: 13px/1.4 Roboto, system-ui, sans-serif;
      }
      #${BOX_ID} .k { font-size: 10px; opacity: .75; margin-bottom: 6px; text-transform: uppercase; }
      #${BOX_ID} .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureBox() {
    let el = document.getElementById(BOX_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BOX_ID;
      const k = document.createElement('div');
      k.className = 'k';
      k.textContent = 'Skipped first 3 comments';
      el.appendChild(k);
      for (let i = 0; i < SKIP; i++) {
        const n = document.createElement('div');
        n.className = 'n';
        n.textContent = i + 1 + '. ¡­';
        el.appendChild(n);
      }
    }
    const host = document.body || document.documentElement;
    if (el.parentNode !== host) host.appendChild(el);
    return el;
  }

  function removeBox() {
    const old = document.getElementById(BOX_ID);
    if (old) old.remove();
  }

  function author(thread) {
    const n = thread.querySelector('#author-text, a#author-text');
    const t = n && n.textContent && n.textContent.trim();
    return t ? t.replace(/^@/, '') : '';
  }

  function topThreads() {
    const roots = document.querySelectorAll(
      'ytd-comments #contents, #comments ytd-item-section-renderer #contents'
    );
    for (const root of roots) {
      const list = [];
      for (const c of root.children) {
        if (c.localName === 'ytd-comment-thread-renderer') list.push(c);
      }
      if (list.length) return list;
    }
    return [];
  }

  const COUNT_RE = /(\d[\d,]*)/;

  function parseIntCount(text) {
    const m = String(text || '').replace(/\u00a0/g, ' ').match(COUNT_RE);
    if (!m) return null;
    return parseInt(m[1].replace(/,/g, ''), 10);
  }

  function looksLikeCommentCount(text) {
    const t = String(text || '');
    return /comment|ÆÀÂÛ|ÁôÑÔ|¥³¥á¥ó¥È|kommentar|comentario|commentaire|§Ü§à§Þ§Þ§Ö§ß§ä§Ñ§â|yorum/i.test(t)
      && COUNT_RE.test(t);
  }

  function deepFindCountText(obj, depth) {
    if (!obj || depth > 6) return '';
    if (typeof obj === 'string') return looksLikeCommentCount(obj) ? obj : '';
    if (Array.isArray(obj)) {
      for (const x of obj) {
        const s = deepFindCountText(x, depth + 1);
        if (s) return s;
      }
      return '';
    }
    if (typeof obj === 'object') {
      for (const k of ['simpleText', 'text', 'countText', 'commentsCount', 'content']) {
        if (k in obj) {
          const s = deepFindCountText(obj[k], depth + 1);
          if (s) return s;
        }
      }
      if (obj.runs && Array.isArray(obj.runs)) {
        const joined = obj.runs.map((r) => r && r.text ? r.text : '').join('');
        if (looksLikeCommentCount(joined)) return joined;
      }
    }
    return '';
  }

  function officialCountFromHeader(header) {
    const bags = [header.data, header.__data, header.__data && header.__data.data];
    for (const bag of bags) {
      const s = deepFindCountText(bag, 0);
      const n = parseIntCount(s);
      if (n != null) return n;
    }
    return null;
  }

  function replaceNumberInText(el, next) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (COUNT_RE.test(node.nodeValue || '')) {
        node.nodeValue = node.nodeValue.replace(COUNT_RE, String(next));
        return true;
      }
    }
    if (COUNT_RE.test(el.textContent || '')) {
      el.textContent = el.textContent.replace(COUNT_RE, String(next));
      return true;
    }
    return false;
  }

  function rewriteCountEl(el, header) {
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw || !looksLikeCommentCount(raw)) return;

    const visible = parseIntCount(raw);
    if (visible == null) return;

    const official = officialCountFromHeader(header);
    let orig = parseInt(el.getAttribute('data-skip3-orig') || '', 10);
    if (!Number.isFinite(orig)) orig = NaN;

    let source;
    if (official != null) {
      source = official;
    } else if (visible === orig - SKIP && Number.isFinite(orig)) {
      source = orig;
    } else if (!Number.isFinite(orig) || visible > orig) {
      source = visible;
    } else {
      source = orig;
    }

    el.setAttribute('data-skip3-orig', String(source));
    const next = Math.max(0, source - SKIP);

    if (visible !== next) {
      el.removeAttribute('data-skip3-shown');
      replaceNumberInText(el, next);
    }
    el.setAttribute('data-skip3-shown', String(next));
  }

  function patchCommentCounts() {
    const headers = document.querySelectorAll('ytd-comments-header-renderer');
    headers.forEach((header) => {
      const nodes = header.querySelectorAll(
        '#count yt-formatted-string, #count, .count-text, yt-formatted-string'
      );
      const seen = new Set();
      nodes.forEach((el) => {
        if (seen.has(el)) return;
        if (el.closest('ytd-comment-thread-renderer')) return;
        if (!looksLikeCommentCount((el.textContent || '').trim())) return;
        if (el.childElementCount > 2) return;
        seen.add(el);
        rewriteCountEl(el, header);
      });
    });
  }

  const countMo = new MutationObserver(() => {
    patchCommentCounts();
  });

  function watchCounts() {
    document.querySelectorAll('ytd-comments-header-renderer, ytd-comments').forEach((root) => {
      if (root.getAttribute('data-skip3-watched')) return;
      root.setAttribute('data-skip3-watched', '1');
      countMo.observe(root, { childList: true, subtree: true, characterData: true });
    });
  }

  function paintBox() {
    if (!SHOW_BOX) {
      removeBox();
      return;
    }
    const el = ensureBox();
    const list = topThreads();
    const rows = el.querySelectorAll('.n');
    for (let i = 0; i < SKIP; i++) {
      const name = list[i] ? author(list[i]) : '';
      rows[i].textContent = i + 1 + '. ' + (name || 'waiting¡­');
    }
  }

  function paint() {
    injectStyle();
    if (!/\/watch/.test(location.pathname)) {
      removeBox();
      return;
    }
    paintBox();
    watchCounts();
    patchCommentCounts();
  }

  function boot() {
    injectStyle();
    paint();
    setInterval(paint, 400);
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
  window.addEventListener('yt-navigate-finish', paint);
})();