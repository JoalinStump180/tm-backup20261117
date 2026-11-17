// ==UserScript==
// @name               Grok Past Asks Viewer
// @namespace          https://github.com/wanda1416/ai-chat-exporter
// @version            0.1.5-local
// @author             wanda1416
// @description        On grok.com, open a wizard of the first 10 sessions, preview each ask (order, stamp, first 5 lines, word count), and right-click Jump to to open the ask and answer in a tab.
// @license            MIT
// @match              https://grok.com/*
// @grant              none
// @run-at             document-idle
// ==/UserScript==

/* eslint-disable */

(function () {
  "use strict";

  const BASE = "https://grok.com/rest/";
  const PAGE_SIZE = 10;

  async function get(path) {
    const response = await fetch(`${BASE}${path}`, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
    return response.json();
  }

  async function post(path, body) {
    const response = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body || {})
    });
    if (!response.ok) throw new Error(`POST ${path} failed: ${response.status}`);
    return response.json();
  }

  function listConversations() {
    return get(`app-chat/conversations?pageSize=${PAGE_SIZE}`);
  }

  function responseNodes(id) {
    return get(`app-chat/conversations/${encodeURIComponent(id)}/response-node`);
  }

  function loadResponses(id, ids) {
    return post(`app-chat/conversations/${encodeURIComponent(id)}/load-responses`, { responseIds: ids });
  }

  function isAssistant(sender) {
    return String(sender || "").toLowerCase() === "assistant";
  }

  function formatAt(iso, gtzHours) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return "";
    const d = new Date(ms + gtzHours * 3600000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  function wordCount(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  function firstLines(text, n) {
    return String(text || "").split(/\r?\n/).slice(0, n).join("\n");
  }

  function el(tag, styles, attrs) {
    const node = document.createElement(tag);
    if (styles) Object.assign(node.style, styles);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === "text") node.textContent = value;
        else node.setAttribute(key, value);
      }
    }
    return node;
  }

  function readGtz(input) {
    const n = Number.parseFloat(String(input.value).trim());
    return Number.isFinite(n) ? n : 8;
  }

  async function loadAsks(conversationId) {
    const skeleton = await responseNodes(conversationId);
    const nodes = skeleton.responseNodes || [];
    const ids = nodes.map((n) => n.responseId).filter(Boolean);
    if (!ids.length) return [];
    const loaded = await loadResponses(conversationId, ids);
    const byId = new Map();
    for (const raw of loaded.responses || []) {
      if (raw.responseId) byId.set(raw.responseId, raw);
    }
    const ordered = [];
    for (const node of nodes) {
      const raw = byId.get(node.responseId);
      if (raw) ordered.push(raw);
    }
    ordered.sort((a, b) => String(a.createTime || "").localeCompare(String(b.createTime || "")));
    const asks = [];
    for (let i = 0; i < ordered.length; i++) {
      const raw = ordered[i];
      if (isAssistant(raw.sender)) continue;
      let answer = null;
      for (let j = i + 1; j < ordered.length; j++) {
        if (isAssistant(ordered[j].sender)) {
          answer = ordered[j];
          break;
        }
      }
      asks.push({
        order: asks.length + 1,
        ask: raw,
        answer
      });
    }
    return asks;
  }

  const pasteTabs = new Map();

  function siteLabel() {
    const host = (location.hostname || "grok").split(".")[0] || "grok";
    return host.toUpperCase();
  }

  function tabTitle(meta) {
    const title = (meta && (meta.title || meta.conversationId)) || "untitled";
    return `${siteLabel()} — ${title}`;
  }

  function pasteTabDoc(meta) {
    const key = (meta && meta.conversationId) || "default";
    let tab = pasteTabs.get(key);
    if (tab && !tab.closed) return tab;
    tab = window.open("", `grok-past-asks-${key}`);
    if (!tab) return null;
    const title = tabTitle(meta);
    tab.document.open();
    tab.document.write("<!doctype html><html><head><meta charset=\"utf-8\"><title></title><style>body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:760px;color:#111;background:#fff}h1{font-size:16px;margin:0 0 16px}article{margin:0 0 20px}.meta{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#666;margin-bottom:4px}.ask,.answer{white-space:pre-wrap;padding:10px 12px;border-radius:12px}.ask{background:#f3f3f3;margin:0 0 8px 15%}.answer{background:#fafafa;margin:0 15% 0 0;border:1px solid #eee}button{border:1px solid #ccc;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}</style></head><body><h1></h1><div id=\"pairs\"></div></body></html>");
    tab.document.close();
    tab.document.title = title;
    const heading = tab.document.querySelector("h1");
    if (heading) heading.textContent = title;
    tab.MathJax = {
      tex: {
        inlineMath: [["$", "$"], ["\\(", "\\)"]],
        displayMath: [["$$", "$$"], ["\\[", "\\]"]]
      },
      startup: { typeset: false }
    };
    pasteTabs.set(key, tab);
    return tab;
  }

  function ensureMathJax(tab) {
    if (tab.MathJax && tab.MathJax.typesetPromise && tab.MathJax.startup && tab.MathJax.startup.promise) {
      return tab.MathJax.startup.promise;
    }
    if (tab.__mjLoading) return tab.__mjLoading;
    tab.__mjLoading = new Promise((resolve, reject) => {
      const script = tab.document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
      script.async = true;
      script.onload = () => resolve(tab.MathJax.startup.promise);
      script.onerror = () => reject(new Error("MathJax failed to load"));
      tab.document.head.appendChild(script);
    });
    return tab.__mjLoading;
  }

  function renderBubble(tab, btn) {
    const block = btn.parentElement && btn.parentElement.nextElementSibling;
    if (!block) return;
    btn.disabled = true;
    btn.textContent = "Rendering…";
    ensureMathJax(tab).then(() => tab.MathJax.typesetPromise([block])).then(() => {
      btn.textContent = "Rendered";
    }).catch((error) => {
      btn.disabled = false;
      btn.textContent = "Render failed";
      btn.title = error && error.message ? error.message : String(error);
    });
  }

  function appendPair(item, gtz, meta) {
    const tab = pasteTabDoc(meta);
    if (!tab) {
      alert("Popup blocked. Allow popups for grok.com and try Jump to again.");
      return false;
    }
    const root = tab.document.getElementById("pairs");
    if (!root) return false;
    const askStamp = item.ask.createTime ? formatAt(item.ask.createTime, gtz) : "";
    const ansStamp = item.answer && item.answer.createTime ? formatAt(item.answer.createTime, gtz) : "";
    const article = tab.document.createElement("article");
    const askMeta = tab.document.createElement("div");
    askMeta.className = "meta";
    askMeta.append(tab.document.createTextNode(`#${item.order} · Ask${askStamp ? " · " + askStamp : ""}`));
    const askBtn = tab.document.createElement("button");
    askBtn.type = "button";
    askBtn.textContent = "Render";
    askBtn.addEventListener("click", () => renderBubble(tab, askBtn));
    askMeta.append(askBtn);
    const ask = tab.document.createElement("div");
    ask.className = "ask";
    ask.textContent = item.ask.message || "";
    const ansMeta = tab.document.createElement("div");
    ansMeta.className = "meta";
    ansMeta.append(tab.document.createTextNode(`#${item.order} · Answer${ansStamp ? " · " + ansStamp : ""}`));
    const ansBtn = tab.document.createElement("button");
    ansBtn.type = "button";
    ansBtn.textContent = "Render";
    ansBtn.addEventListener("click", () => renderBubble(tab, ansBtn));
    ansMeta.append(ansBtn);
    const answer = tab.document.createElement("div");
    answer.className = "answer";
    answer.textContent = (item.answer && item.answer.message) || "(no answer)";
    article.append(askMeta, ask, ansMeta, answer);
    root.appendChild(article);
    tab.focus();
    article.scrollIntoView({ block: "end" });
    return true;
  }

  function parseRanges(text) {
    const ranges = [];
    for (const part of String(text || "").split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const match = piece.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return null;
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : from;
      if (to < from) return null;
      ranges.push([from, to]);
    }
    return ranges;
  }

  function orderInRanges(order, ranges) {
    return ranges.some(([from, to]) => order >= from && order <= to);
  }

  let menu = null;
  function closeMenu() {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  function openMenu(x, y, onJump) {
    closeMenu();
    menu = el("div", {
      position: "fixed",
      left: `${x}px`,
      top: `${y}px`,
      zIndex: "2147483647",
      background: "#fff",
      color: "#111",
      border: "1px solid #ccc",
      borderRadius: "8px",
      boxShadow: "0 6px 20px rgba(0,0,0,.25)",
      padding: "4px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px"
    });
    const item = el("button", {
      display: "block",
      width: "100%",
      textAlign: "left",
      border: "none",
      background: "#fff",
      color: "#111",
      padding: "6px 12px",
      borderRadius: "6px",
      cursor: "pointer"
    }, { text: "Jump to" });
    item.type = "button";
    item.addEventListener("click", () => {
      closeMenu();
      onJump();
    });
    menu.append(item);
    document.body.appendChild(menu);
  }

  function openWizard() {
    const overlay = el("div", {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      background: "rgba(0,0,0,.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    });
    const panel = el("div", {
      background: "#fff",
      color: "#111",
      colorScheme: "light",
      borderRadius: "12px",
      padding: "16px",
      width: "min(720px, calc(100vw - 24px))",
      maxHeight: "min(86vh, 760px)",
      overflow: "auto",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      boxShadow: "0 8px 30px rgba(0,0,0,.35)"
    });
    const header = el("div", { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" });
    const title = el("div", { fontSize: "15px", fontWeight: "600" }, { text: "Grok past asks" });
    const closeBtn = el("button", {
      border: "1px solid #ccc",
      background: "#fff",
      borderRadius: "8px",
      padding: "4px 10px",
      cursor: "pointer"
    }, { text: "Close" });
    closeBtn.type = "button";
    header.append(title, closeBtn);
    const gtzRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" });
    const gtzInput = el("input", {
      width: "72px",
      padding: "6px 8px",
      border: "1px solid #ccc",
      borderRadius: "6px"
    });
    gtzInput.type = "text";
    gtzInput.value = "+8";
    gtzRow.append(el("span", { fontWeight: "600" }, { text: "GTZ" }), gtzInput);
    const rangeRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" });
    const rangeInput = el("input", {
      flex: "1",
      padding: "6px 8px",
      border: "1px solid #ccc",
      borderRadius: "6px"
    });
    rangeInput.type = "text";
    rangeInput.value = "1-999";
    rangeInput.placeholder = "1-2,23-34";
    rangeRow.append(el("span", { fontWeight: "600" }, { text: "Range" }), rangeInput);
    const status = el("div", { color: "#666", marginBottom: "8px" }, { text: "Loading first 10 sessions…" });
    const list = el("div");
    panel.append(header, gtzRow, rangeRow, status, list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = () => {
      closeMenu();
      overlay.remove();
    };
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener("click", closeMenu);

    function renderSessions(items) {
      list.replaceChildren();
      status.textContent = `${items.length} session${items.length === 1 ? "" : "s"} (newest first). Right-click an ask, then Jump to.`;
      items.forEach((meta, index) => {
        const row = el("div", {
          display: "flex",
          gap: "8px",
          alignItems: "center",
          padding: "8px",
          borderBottom: "1px solid #eee"
        });
        const label = el("div", { flex: "1", wordBreak: "break-word" }, { text: `${index + 1}. ${meta.title || meta.conversationId}` });
        const btn = el("button", {
          border: "1px solid #ccc",
          background: "#fff",
          borderRadius: "8px",
          padding: "4px 10px",
          cursor: "pointer"
        }, { text: "View asks" });
        btn.type = "button";
        btn.addEventListener("click", () => showAsks(meta));
        row.append(label, btn);
        list.append(row);
      });
    }

    function renderAsks(meta, asks) {
      list.replaceChildren();
      const back = el("button", {
        border: "1px solid #ccc",
        background: "#fff",
        borderRadius: "8px",
        padding: "4px 10px",
        cursor: "pointer",
        marginBottom: "8px"
      }, { text: "Back to sessions" });
      back.type = "button";
      back.addEventListener("click", () => {
        status.textContent = "Reloading sessions…";
        loadSessions();
      });
      list.append(back);
      status.textContent = `${asks.length} ask${asks.length === 1 ? "" : "s"} in “${meta.title || meta.conversationId}”. Set Range, then right-click and Jump to.`;
      if (!asks.length) {
        list.append(el("div", { color: "#888" }, { text: "No asks in this session." }));
        return;
      }
      const rows = [];
      const applyRange = () => {
        const ranges = parseRanges(rangeInput.value);
        if (!ranges) {
          status.textContent = "Bad range. Use 1-2,23-34.";
          return;
        }
        let checked = 0;
        for (const row of rows) {
          row.box.checked = orderInRanges(row.item.order, ranges);
          if (row.box.checked) checked += 1;
        }
        status.textContent = `${checked} of ${asks.length} checked from “${rangeInput.value}”. Right-click and Jump to.`;
      };
      rangeInput.oninput = applyRange;
      asks.forEach((item) => {
        const row = el("label", {
          display: "flex",
          gap: "8px",
          alignItems: "flex-start",
          padding: "8px",
          borderBottom: "1px solid #eee",
          cursor: "context-menu"
        });
        const box = el("input", { marginTop: "3px" });
        box.type = "checkbox";
        const body = el("div", { flex: "1" });
        const gtz = readGtz(gtzInput);
        const stamp = item.ask.createTime ? formatAt(item.ask.createTime, gtz) : "(no time)";
        const text = item.ask.message || "";
        body.append(el("div", { fontWeight: "600" }, { text: `#${item.order} · ${stamp} · ${wordCount(text)} words` }));
        body.append(el("div", { whiteSpace: "pre-wrap", color: "#333", marginTop: "4px" }, { text: firstLines(text, 5) || "(empty)" }));
        row.append(box, body);
        rows.push({ item, box });
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY, () => {
            const picked = rows.filter((entry) => entry.box.checked).map((entry) => entry.item);
            const targets = picked.length ? picked : [item];
            for (const target of targets) appendPair(target, readGtz(gtzInput), meta);
          });
        });
        list.append(row);
      });
      applyRange();
    }

    async function showAsks(meta) {
      status.textContent = "Loading asks…";
      list.replaceChildren();
      try {
        const asks = await loadAsks(meta.conversationId);
        renderAsks(meta, asks);
      } catch (error) {
        status.textContent = error && error.message ? error.message : String(error);
      }
    }

    async function loadSessions() {
      try {
        const data = await listConversations();
        const items = (data.conversations || []).slice(0, PAGE_SIZE);
        renderSessions(items);
      } catch (error) {
        status.textContent = error && error.message ? error.message : String(error);
      }
    }

    loadSessions();
  }

  function mount() {
    if (document.getElementById("grok-past-asks-btn")) return;
    const button = el("button", {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483645",
      padding: "10px 16px",
      borderRadius: "10px",
      border: "none",
      background: "#111",
      color: "#fff",
      fontSize: "13px",
      cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,.25)"
    }, { text: "Past asks" });
    button.id = "grok-past-asks-btn";
    button.type = "button";
    button.addEventListener("click", openWizard);
    document.body.appendChild(button);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
