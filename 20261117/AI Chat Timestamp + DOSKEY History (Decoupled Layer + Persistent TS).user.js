// ==UserScript==
// @name         AI Chat Timestamp + DOSKEY History (Decoupled Layer + Persistent TS)
// @namespace    https://grok.local/userscripts
// @version      1.6.0
// @description  Decoupled left-side timestamp overlays + Persistent Timestamp Storage + DOSKEY prompt history for Gemini, ChatGPT, and Grok.
// @author       Grok
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @match        https://grok.com/*
// @match        https://x.com/i/grok*
// @match        https://x.com/grok*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// ==/UserScript==

(function () {
  'use strict';

  const ENABLE_TS_DEFAULT = true;
  const ENABLE_DOSKEY_DEFAULT = false;

  function gmGet(k, d) {
    try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch (_) {}
    try {
      const raw = localStorage.getItem('ai-chat-flags');
      if (raw) { const o = JSON.parse(raw); if (k in o) return o[k]; }
    } catch (_) {}
    return d;
  }
  function gmSet(k, v) {
    try { if (typeof GM_setValue === 'function') GM_setValue(k, v); } catch (_) {}
    try {
      const o = JSON.parse(localStorage.getItem('ai-chat-flags') || '{}');
      o[k] = v;
      localStorage.setItem('ai-chat-flags', JSON.stringify(o));
    } catch (_) {}
  }

  let ENABLE_TS = !!gmGet('enableTs', ENABLE_TS_DEFAULT);

  // Persistent Timestamp Store Engine
  const TS_STORAGE_KEY = 'ai_chat_persistent_timestamps';
  function getStoredTimestamps() {
    try {
      return JSON.parse(gmGet(TS_STORAGE_KEY, '{}')) || {};
    } catch (_) {
      return {};
    }
  }
  function saveStoredTimestamps(store) {
    gmSet(TS_STORAGE_KEY, JSON.stringify(store));
  }

  function getMessageTimestamp(cid, text) {
    if (!text) return Date.now();
    const key = `${cid}:${text.slice(0, 100)}`; // Simple unique identifier key
    const store = getStoredTimestamps();
    
    if (store[key]) {
      return store[key];
    } else {
      const now = Date.now();
      store[key] = now;
      saveStoredTimestamps(store);
      return now;
    }
  }

  const host = location.hostname;
  const platform =
    host.includes('gemini') ? 'gemini' :
    host.includes('grok') || host === 'x.com' ? 'grok' :
    (host.includes('chatgpt') || host.includes('openai')) ? 'chatgpt' :
    null;
  if (!platform) return;

  // CSS for Independent Layer
  const style = document.createElement('style');
  style.textContent = `
    #ai-ts-viewport-layer {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
      z-index: 2147483640 !important;
      overflow: hidden !important;
    }
    .ai-ts-fly-badge {
      position: absolute !important;
      font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
      color: #e8e8e8 !important;
      background: rgba(0, 0, 0, 0.55) !important;
      backdrop-filter: blur(4px) !important;
      padding: 2px 6px !important;
      border-radius: 4px !important;
      white-space: nowrap !important;
      pointer-events: none !important;
      transition: transform 0.04s ease-out, opacity 0.15s ease !important;
      will-change: transform, opacity !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  function getViewportLayer() {
    let layer = document.getElementById('ai-ts-viewport-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'ai-ts-viewport-layer';
      (document.body || document.documentElement).appendChild(layer);
    }
    return layer;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function formatStamp(d) {
    let dateObj = d instanceof Date ? d : new Date(Number(d) || d);
    if (isNaN(dateObj.getTime())) dateObj = new Date();
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;
  }

  function queryAllDeep(selector, root = document) {
    const out = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      if (node.querySelectorAll) {
        try { node.querySelectorAll(selector).forEach((el) => out.push(el)); } catch (_) {}
      }
      const kids = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of kids) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
      if (node.shadowRoot) visit(node.shadowRoot);
    };
    visit(root);
    return out;
  }

  function queryUserMessages() {
    const found = [];
    if (platform === "chatgpt") {
      found.push(...queryAllDeep('[data-message-author-role="user"]'));
      found.push(...queryAllDeep(".user-message-bubble-color"));
      found.push(...queryAllDeep("[data-user-message-bubble]"));
    } else if (platform === "gemini") {
      found.push(...queryAllDeep("user-query"));
      found.push(...queryAllDeep(".query-text"));
      found.push(...queryAllDeep(".user-query-container"));
    } else {
      found.push(...queryAllDeep('[data-message-author-role="user"]'));
      found.push(...queryAllDeep("[data-testid='user-message']"));
    }
    const seen = new Set();
    return found.filter((el) => {
      if (!el || seen.has(el) || !(el instanceof HTMLElement)) return false;
      seen.add(el);
      return true;
    });
  }

  function messageText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  function getConversationId() {
    const path = location.pathname || '';
    let m;
    if (platform === 'chatgpt') m = path.match(/\/c\/([^/?#]+)/i);
    else if (platform === 'gemini') m = path.match(/\/(?:app|chat)\/([^/?#]+)/i);
    else if (platform === 'grok') m = path.match(/\/(?:chat|c|conversation)\/([^/?#]+)/i);
    if (m && m[1] !== 'app') return m[1];
    
    const q = new URLSearchParams(location.search);
    for (const key of ['chat', 'cid', 'conversation', 'c']) {
      if (q.get(key)) return q.get(key);
    }
    return path || 'default';
  }

  // Stamp Registry (Tracked flying badges outside Gemini DOM)
  const activeBadges = new Map();

  function updateFlyingBadges() {
    if (!ENABLE_TS) {
      const layer = document.getElementById('ai-ts-viewport-layer');
      if (layer) layer.innerHTML = '';
      activeBadges.clear();
      return;
    }

    const layer = getViewportLayer();
    const elements = queryUserMessages();
    const currentElements = new Set(elements);
    const cid = getConversationId();

    // Remove stale badges for elements no longer in DOM
    for (const [el, data] of activeBadges.entries()) {
      if (!currentElements.has(el) || !el.isConnected) {
        data.badge.remove();
        activeBadges.delete(el);
      }
    }

    // Update positions & sync stored timestamps
    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();

      // Skip off-screen/invisible elements
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
        if (activeBadges.has(el)) {
          activeBadges.get(el).badge.style.opacity = '0';
        }
        return;
      }

      let data = activeBadges.get(el);
      if (!data) {
        const text = messageText(el);
        // Look up persistent timestamp or store new one
        const ts = getMessageTimestamp(cid, text);
        
        const badge = document.createElement('div');
        badge.className = 'ai-ts-fly-badge';
        badge.textContent = formatStamp(ts);
        layer.appendChild(badge);

        data = { badge, text, time: ts };
        activeBadges.set(el, data);
      }

      // Compute exact relative position outside Gemini's shadow tree
      const x = Math.max(10, rect.left - 130);
      const y = rect.top + 2;

      data.badge.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      data.badge.style.opacity = '1';
    });
  }

  // Continuous animation frame loop
  function renderLoop() {
    updateFlyingBadges();
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // Clear memory cache on SPA navigation switches
  let lastPath = location.href;
  setInterval(() => {
    if (location.href !== lastPath) {
      lastPath = location.href;
      const layer = document.getElementById('ai-ts-viewport-layer');
      if (layer) layer.innerHTML = '';
      activeBadges.clear();
    }
  }, 400);

})();