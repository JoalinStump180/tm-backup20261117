// ==UserScript==
// @name         Floating Word Highlighter
// @namespace    http://tampermonkey.net/
// @version      1.4.1
// @description  Draggable input; quoted phrases; case toggle; next/prev hits
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const COLORS = ['#e03131', '#2f9e44', '#f59f00', '#9c36b5'];
  const INPUT_ID = 'tm-word-hl-input';
  const WRAP_ID = 'tm-word-hl-wrap';
  const MARK_CLASS = 'tm-word-hl';
  const CURRENT_CLASS = 'tm-word-hl-current';
  const MAX_WORDS = 3;
  const POS_KEY = 'tm-word-hl-pos';
  const CASE_KEY = 'tm-word-hl-case';

  let caseSensitive = false;
  let hitIndex = -1;
  let countLabel = null;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getWords(raw) {
    const result = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(raw)) !== null && result.length < MAX_WORDS) {
      const token = m[1] != null ? m[1] : m[2];
      if (token) result.push(token);
    }
    return result;
  }

  function sameWord(a, b) {
    return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
  }

  function clearHighlights() {
    document.querySelectorAll('.' + MARK_CLASS).forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
  }

  function shouldSkip(node) {
    const el = node.parentElement;
    if (!el) return true;
    if (el.closest('#' + WRAP_ID + ', script, style, noscript, textarea, input, select, [contenteditable="true"]')) {
      return true;
    }
    if (el.classList.contains(MARK_CLASS)) return true;
    return false;
  }

  function collectTextNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function getHits() {
    return Array.from(document.querySelectorAll('.' + MARK_CLASS));
  }

  function clearCurrent() {
    document.querySelectorAll('.' + CURRENT_CLASS).forEach((el) => {
      el.classList.remove(CURRENT_CLASS);
      el.style.outline = '';
      el.style.outlineOffset = '';
    });
  }

  function updateCount() {
    if (!countLabel) return;
    const hits = getHits();
    if (!hits.length) {
      countLabel.textContent = '0';
      return;
    }
    countLabel.textContent = (hitIndex < 0 ? 0 : hitIndex + 1) + '/' + hits.length;
  }

  function focusHit(i, scroll) {
    const hits = getHits();
    clearCurrent();
    if (!hits.length) {
      hitIndex = -1;
      updateCount();
      return;
    }
    hitIndex = ((i % hits.length) + hits.length) % hits.length;
    const el = hits[hitIndex];
    el.classList.add(CURRENT_CLASS);
    el.style.outline = '2px solid #1c7ed6';
    el.style.outlineOffset = '1px';
    if (scroll) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
    updateCount();
  }

  function nextHit() {
    const hits = getHits();
    if (!hits.length) return;
    focusHit(hitIndex < 0 ? 0 : hitIndex + 1, true);
  }

  function prevHit() {
    const hits = getHits();
    if (!hits.length) return;
    focusHit(hitIndex < 0 ? hits.length - 1 : hitIndex - 1, true);
  }

  function highlightWords(words) {
    clearHighlights();
    hitIndex = -1;
    if (!words.length) {
      updateCount();
      return;
    }

    const ordered = words
      .map((w, i) => ({ w, i }))
      .sort((a, b) => b.w.length - a.w.length);

    const flags = caseSensitive ? 'g' : 'gi';
    const re = new RegExp('(' + ordered.map((x) => escapeRegExp(x.w)).join('|') + ')', flags);

    collectTextNodes().forEach((textNode) => {
      if (!textNode.parentNode) return;
      const text = textNode.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) {
          frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        }
        const found = m[1];
        const idx = words.findIndex((w) => sameWord(w, found));
        const span = document.createElement('span');
        span.className = MARK_CLASS;
        span.style.backgroundColor = COLORS[idx >= 0 ? idx : 0];
        span.style.color = '#111';
        span.style.padding = '0 1px';
        span.style.borderRadius = '2px';
        span.style.boxDecorationBreak = 'clone';
        span.textContent = found;
        frag.appendChild(span);
        last = re.lastIndex;
      }
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    });

    const hits = getHits();
    if (hits.length) focusHit(0, false);
    else updateCount();
  }

  function rerun(input) {
    highlightWords(getWords(input.value));
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.left === 'number' && typeof p.top === 'number') return p;
    } catch (_) {}
    return null;
  }

  function savePos(left, top) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
    } catch (_) {}
  }

  function loadCase() {
    try {
      return localStorage.getItem(CASE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function saveCase() {
    try {
      localStorage.setItem(CASE_KEY, caseSensitive ? '1' : '0');
    } catch (_) {}
  }

  function paintToggle(btn) {
    btn.textContent = 'Aa';
    btn.title = caseSensitive ? 'Case sensitive (click for insensitive)' : 'Case insensitive (click for sensitive)';
    btn.style.opacity = caseSensitive ? '1' : '0.55';
    btn.style.fontWeight = caseSensitive ? '800' : '500';
    btn.style.textDecoration = caseSensitive ? 'underline' : 'none';
  }

  function makeDraggable(wrap) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('input, button')) return;
      const rect = wrap.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      e.preventDefault();

      const w = wrap.offsetWidth;
      const h = wrap.offsetHeight;
      const left = clamp(origLeft + dx, 0, window.innerWidth - w);
      const top = clamp(origTop + dy, 0, window.innerHeight - h);
      wrap.style.left = left + 'px';
      wrap.style.top = top + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        const rect = wrap.getBoundingClientRect();
        savePos(rect.left, rect.top);
      }
    });
  }

  function mountInput() {
    if (document.getElementById(WRAP_ID)) return;

    caseSensitive = loadCase();

    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;

    const saved = loadPos();
    Object.assign(wrap.style, {
      position: 'fixed',
      top: saved ? saved.top + 'px' : '10px',
      left: saved ? saved.left + 'px' : 'auto',
      right: saved ? 'auto' : '10px',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 6px 4px 4px',
      background: 'transparent',
      border: '1px solid rgba(128,128,128,0.55)',
      borderRadius: '8px',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      cursor: 'grab',
      userSelect: 'none',
    });

    const handle = document.createElement('div');
    handle.title = 'drag';
    Object.assign(handle.style, {
      width: '10px',
      height: '22px',
      flex: '0 0 10px',
      borderRadius: '3px',
      background:
        'repeating-linear-gradient(180deg, rgba(128,128,128,0.7) 0 2px, transparent 2px 4px)',
      cursor: 'grab',
    });

    const input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'text';
    input.placeholder = '"phrase" or words…';
    input.autocomplete = 'off';
    input.spellcheck = false;

    Object.assign(input.style, {
      width: '200px',
      padding: '4px 8px',
      fontSize: '14px',
      lineHeight: '1.3',
      color: 'inherit',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      boxShadow: 'none',
      cursor: 'text',
      userSelect: 'text',
    });

    function miniBtn(label, title) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      Object.assign(b.style, {
        flex: '0 0 auto',
        minWidth: '22px',
        padding: '2px 5px',
        fontSize: '12px',
        lineHeight: '1.2',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid rgba(128,128,128,0.45)',
        borderRadius: '4px',
        cursor: 'pointer',
      });
      return b;
    }

    const prevBtn = miniBtn('?', 'Previous hit');
    const nextBtn = miniBtn('?', 'Next hit');
    countLabel = document.createElement('span');
    countLabel.textContent = '0';
    countLabel.title = 'Current hit / total';
    Object.assign(countLabel.style, {
      flex: '0 0 auto',
      minWidth: '28px',
      fontSize: '11px',
      lineHeight: '1.2',
      textAlign: 'center',
      opacity: '0.85',
      userSelect: 'none',
    });
    prevBtn.addEventListener('click', prevHit);
    nextBtn.addEventListener('click', nextHit);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    Object.assign(toggle.style, {
      flex: '0 0 auto',
      padding: '2px 6px',
      fontSize: '12px',
      lineHeight: '1.2',
      color: 'inherit',
      background: 'transparent',
      border: '1px solid rgba(128,128,128,0.45)',
      borderRadius: '4px',
      cursor: 'pointer',
    });
    paintToggle(toggle);
    toggle.addEventListener('click', () => {
      caseSensitive = !caseSensitive;
      saveCase();
      paintToggle(toggle);
      rerun(input);
    });

    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => rerun(input), 200);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) prevHit();
        else nextHit();
      }
    });

    wrap.appendChild(handle);
    wrap.appendChild(input);
    wrap.appendChild(prevBtn);
    wrap.appendChild(countLabel);
    wrap.appendChild(nextBtn);
    wrap.appendChild(toggle);
    document.documentElement.appendChild(wrap);
    makeDraggable(wrap);
  }

  mountInput();
})();
