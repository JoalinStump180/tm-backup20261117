// ==UserScript==
// @name         Floating Word Highlighter
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Draggable input; quoted phrases; case toggle; top-N misspelling tokens (blue/red)
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const COLORS = ['#e03131', '#2f9e44', '#f59f00', '#9c36b5'];
  const FUZZY_BLUE = '#4dabf7';
  const FUZZY_RED = '#fa5252';
  const INPUT_ID = 'tm-word-hl-input';
  const FUZZY_ID = 'tm-word-hl-fuzzy-n';
  const WRAP_ID = 'tm-word-hl-wrap';
  const MARK_CLASS = 'tm-word-hl';
  const FUZZY_CLASS = 'tm-word-hl-fuzzy';
  const MAX_WORDS = 3;
  const POS_KEY = 'tm-word-hl-pos';
  const CASE_KEY = 'tm-word-hl-case';
  const FUZZY_KEY = 'tm-word-hl-fuzzy-n';
  const TOKEN_RE = /[A-Za-z][A-Za-z0-9']*/g;

  let caseSensitive = false;
  let fuzzyN = 0;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function norm(s) {
    return caseSensitive ? s : s.toLowerCase();
  }

  function getWords(raw) {
    const result = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(raw)) !== null && result.length < MAX_WORDS) {
      const token = m[1] != null ? m[1] : m[2];
      if (token) result.push({ text: token, quoted: m[1] != null });
    }
    return result;
  }

  function sameWord(a, b) {
    return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
  }

  function similarity(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigrams = new Map();
    for (let i = 0; i < a.length - 1; i++) {
      const bg = a.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    let overlap = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const bg = b.slice(i, i + 2);
      const count = bigrams.get(bg);
      if (count) {
        overlap++;
        bigrams.set(bg, count - 1);
      }
    }
    return (2 * overlap) / (a.length + b.length - 2);
  }

  function levenshtein(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    if (a === b) return 0;
    const n = a.length;
    const m = b.length;
    if (!n) return m;
    if (!m) return n;
    let prev = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= n; i++) {
      const curr = [i];
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = curr;
    }
    return prev[m];
  }

  function maxEdits(qLen) {
    return Math.max(1, Math.min(3, Math.floor(qLen / 3) || 1));
  }

  function scorePair(query, token) {
    if (sameWord(query, token)) return 0;
    const ql = query.length;
    const tl = token.length;
    if (ql < 2 || tl < 2) return 0;
    if (Math.abs(ql - tl) > maxEdits(ql)) return 0;
    const d = levenshtein(query, token);
    if (d === 0 || d > maxEdits(ql)) return 0;
    const dice = similarity(query, token);
    const levSim = 1 - d / Math.max(ql, tl);
    return dice * 0.45 + levSim * 0.55;
  }

  function alignSegments(query, found) {
    const a = caseSensitive ? query : query.toLowerCase();
    const b = caseSensitive ? found : found.toLowerCase();
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    const marks = new Array(m).fill(false);
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
        marks[j - 1] = a[i - 1] !== b[j - 1];
        i--;
        j--;
      } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
        marks[j - 1] = true;
        j--;
      } else {
        i--;
      }
    }
    const segs = [];
    for (let k = 0; k < found.length; k++) {
      const bad = !!marks[k];
      if (!segs.length || segs[segs.length - 1].bad !== bad) {
        segs.push({ bad, text: found[k] });
      } else {
        segs[segs.length - 1].text += found[k];
      }
    }
    return segs;
  }

  function clearHighlights() {
    document.querySelectorAll('.' + MARK_CLASS + ', .' + FUZZY_CLASS).forEach((el) => {
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
    if (el.classList.contains(MARK_CLASS) || el.classList.contains(FUZZY_CLASS)) return true;
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

  function collectUniqueTokens(nodes) {
    const seen = new Set();
    const tokens = [];
    for (const node of nodes) {
      const text = node.nodeValue;
      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        const t = m[0];
        const key = norm(t);
        if (key.length < 2 || seen.has(key)) continue;
        seen.add(key);
        tokens.push(t);
      }
    }
    return tokens;
  }

  function pickFuzzyVariants(queryWords, pageTokens) {
    const variants = [];
    const used = new Set();
    for (const qw of queryWords) {
      if (qw.quoted) continue;
      const q = qw.text;
      if (!/^[A-Za-z]/.test(q)) continue;
      const ranked = [];
      for (const t of pageTokens) {
        const key = norm(t);
        if (used.has(key)) continue;
        const s = scorePair(q, t);
        if (s <= 0) continue;
        ranked.push({ token: t, key, score: s, query: q });
      }
      ranked.sort((a, b) => b.score - a.score || a.token.length - b.token.length);
      let taken = 0;
      for (const row of ranked) {
        if (taken >= fuzzyN) break;
        used.add(row.key);
        variants.push(row);
        taken++;
      }
    }
    return variants;
  }

  function styleExact(span, colorIdx) {
    span.className = MARK_CLASS;
    span.style.backgroundColor = COLORS[colorIdx >= 0 ? colorIdx : 0];
    span.style.color = '#111';
    span.style.padding = '0 1px';
    span.style.borderRadius = '2px';
    span.style.boxDecorationBreak = 'clone';
  }

  function makeFuzzySpan(found, query) {
    const outer = document.createElement('span');
    outer.className = FUZZY_CLASS;
    outer.title = '≈ ' + query;
    Object.assign(outer.style, {
      backgroundColor: FUZZY_BLUE,
      color: '#111',
      padding: '0 1px',
      borderRadius: '2px',
      boxDecorationBreak: 'clone',
    });
    const segs = alignSegments(query, found);
    for (const seg of segs) {
      if (!seg.bad) {
        outer.appendChild(document.createTextNode(seg.text));
      } else {
        const bad = document.createElement('span');
        bad.style.backgroundColor = FUZZY_RED;
        bad.style.color = '#fff';
        bad.style.borderRadius = '2px';
        bad.textContent = seg.text;
        outer.appendChild(bad);
      }
    }
    return outer;
  }

  function highlightWords(queryWords) {
    clearHighlights();
    if (!queryWords.length) return;

    const exactTexts = queryWords.map((w) => w.text);
    const nodes = collectTextNodes();

    let fuzzyList = [];
    if (fuzzyN > 0) {
      const pageTokens = collectUniqueTokens(nodes);
      fuzzyList = pickFuzzyVariants(queryWords, pageTokens);
    }

    const terms = [];
    exactTexts.forEach((w, i) => {
      terms.push({ w, exact: true, i, query: w });
    });
    fuzzyList.forEach((row) => {
      terms.push({ w: row.token, exact: false, i: -1, query: row.query });
    });
    if (!terms.length) return;

    terms.sort((a, b) => b.w.length - a.w.length);

    const flags = caseSensitive ? 'g' : 'gi';
    const re = new RegExp('(' + terms.map((x) => escapeRegExp(x.w)).join('|') + ')', flags);

    const exactIndex = (found) => exactTexts.findIndex((w) => sameWord(w, found));
    const fuzzyMeta = (found) => fuzzyList.find((row) => sameWord(row.token, found));

    nodes.forEach((textNode) => {
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
        const ei = exactIndex(found);
        if (ei >= 0) {
          const span = document.createElement('span');
          styleExact(span, ei);
          span.textContent = found;
          frag.appendChild(span);
        } else {
          const meta = fuzzyMeta(found);
          frag.appendChild(makeFuzzySpan(found, meta ? meta.query : found));
        }
        last = re.lastIndex;
      }
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    });
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

  function loadFuzzyN() {
    try {
      const n = parseInt(localStorage.getItem(FUZZY_KEY) || '0', 10);
      if (!Number.isFinite(n)) return 0;
      return clamp(n, 0, 9);
    } catch (_) {
      return 0;
    }
  }

  function saveFuzzyN() {
    try {
      localStorage.setItem(FUZZY_KEY, String(fuzzyN));
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
    fuzzyN = loadFuzzyN();

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

    const fuzzyBox = document.createElement('input');
    fuzzyBox.id = FUZZY_ID;
    fuzzyBox.type = 'number';
    fuzzyBox.min = '0';
    fuzzyBox.max = '9';
    fuzzyBox.step = '1';
    fuzzyBox.value = String(fuzzyN);
    fuzzyBox.title = 'Top-N distinct misspelling tokens (0 = exact only)';
    Object.assign(fuzzyBox.style, {
      width: '36px',
      flex: '0 0 36px',
      padding: '2px 2px',
      fontSize: '12px',
      lineHeight: '1.3',
      textAlign: 'center',
      color: 'inherit',
      background: 'transparent',
      border: '1px solid rgba(128,128,128,0.45)',
      borderRadius: '4px',
      outline: 'none',
      cursor: 'text',
      userSelect: 'text',
    });

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
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => rerun(input), 200);
    };

    input.addEventListener('input', schedule);

    fuzzyBox.addEventListener('input', () => {
      const n = parseInt(fuzzyBox.value, 10);
      fuzzyN = Number.isFinite(n) ? clamp(n, 0, 9) : 0;
      saveFuzzyN();
      schedule();
    });
    fuzzyBox.addEventListener('change', () => {
      fuzzyBox.value = String(fuzzyN);
    });

    wrap.appendChild(handle);
    wrap.appendChild(input);
    wrap.appendChild(fuzzyBox);
    wrap.appendChild(toggle);
    document.documentElement.appendChild(wrap);
    makeDraggable(wrap);
  }

  mountInput();
})();
