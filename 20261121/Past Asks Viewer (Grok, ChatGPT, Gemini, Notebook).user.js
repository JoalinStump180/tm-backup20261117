// ==UserScript==
// @name               Past Asks Viewer (Grok, ChatGPT, Gemini, Notebook)
// @namespace          https://github.com/wanda1416/ai-chat-exporter
// @version            0.2.3-gemini-tab
// @author             wanda1416
// @description        On Grok, ChatGPT, Gemini, or NotebookLM, open a wizard of the first 10 sessions, preview each ask, and Jump to a tab.
// @license            MIT
// @match              https://grok.com/*
// @match              https://chatgpt.com/*
// @match              https://gemini.google.com/*
// @match              https://notebook.google.com/*
// @match              https://notebooklm.google.com/*
// @grant              none
// @run-at             document-idle
// ==/UserScript==

/* eslint-disable */

(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const asArray = (v) => Array.isArray(v) ? v : [];
  const asString = (v) => typeof v === "string" && v.length > 0 ? v : "";
  const at = (v, i) => Array.isArray(v) ? v[i] : void 0;

  function detectPlatform() {
    const host = location.hostname;
    if (/(^|\.)grok\.com$/.test(host)) return "grok";
    if (/(^|\.)chatgpt\.com$/.test(host)) return "chatgpt";
    if (/(^|\.)gemini\.google\.com$/.test(host)) return "gemini";
    if (/(^|\.)notebook\.google\.com$/.test(host) || /(^|\.)notebooklm\.google\.com$/.test(host)) return "notebook";
    return "";
  }

  async function httpJson(url, options) {
    const response = await fetch(url, Object.assign({ credentials: "include" }, options || {}));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  function extractRpcPayload(rawBody, rpcid) {
    const body = rawBody.replace(/^\)\]\}'\s*/, "");
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("[")) continue;
      let chunk;
      try { chunk = JSON.parse(trimmed); } catch { continue; }
      for (const entry of asArray(chunk)) {
        if (Array.isArray(entry) && entry[0] === "wrb.fr" && entry[1] === rpcid && typeof entry[2] === "string") {
          return JSON.parse(entry[2]);
        }
      }
    }
    throw new Error(`No ${rpcid} payload`);
  }

  async function batchExecute(baseUrl, rpcid, innerPayload, sourcePath) {
    const wiz = window.WIZ_global_data || {};
    const atToken = wiz.SNlM0e;
    if (!atToken) throw new Error("at token not found. Reload the page while logged in.");
    const url = new URL(baseUrl);
    url.searchParams.set("rpcids", rpcid);
    url.searchParams.set("source-path", sourcePath || "/app");
    if (wiz.cfb2h) url.searchParams.set("bl", wiz.cfb2h);
    if (wiz.FdrFJe) url.searchParams.set("f.sid", wiz.FdrFJe);
    url.searchParams.set("hl", "en");
    url.searchParams.set("_reqid", String(Math.floor(Math.random() * 9e4) + 1e5));
    url.searchParams.set("rt", "c");
    const envelope = [[[rpcid, JSON.stringify(innerPayload), null, "generic"]]];
    const body = `f.req=${encodeURIComponent(JSON.stringify(envelope))}&at=${encodeURIComponent(atToken)}&`;
    const response = await fetch(url.toString(), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body
    });
    if (!response.ok) throw new Error(`${rpcid} failed: ${response.status}`);
    return extractRpcPayload(await response.text(), rpcid);
  }

  function pairMessages(messages) {
    const asks = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "user") continue;
      let answer = null;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "assistant") { answer = messages[j]; break; }
      }
      asks.push({
        order: asks.length + 1,
        ask: { message: messages[i].text || "", createTime: messages[i].createTime || "" },
        answer: answer ? { message: answer.text || "", createTime: answer.createTime || "" } : null
      });
    }
    return asks;
  }

  async function grokSessions(limit) {
    const data = await httpJson(`https://grok.com/rest/app-chat/conversations?pageSize=${limit}`);
    return (data.conversations || []).slice(0, limit).map((c) => ({
      conversationId: c.conversationId,
      title: c.title || c.conversationId
    }));
  }

  async function grokAsks(id) {
    const nodes = await httpJson(`https://grok.com/rest/app-chat/conversations/${encodeURIComponent(id)}/response-node`);
    const ids = (nodes.responseNodes || []).map((n) => n.responseId).filter(Boolean);
    if (!ids.length) return [];
    const loaded = await httpJson(`https://grok.com/rest/app-chat/conversations/${encodeURIComponent(id)}/load-responses`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ responseIds: ids })
    });
    const byId = new Map((loaded.responses || []).filter((r) => r.responseId).map((r) => [r.responseId, r]));
    const ordered = (nodes.responseNodes || []).map((n) => byId.get(n.responseId)).filter(Boolean);
    ordered.sort((a, b) => String(a.createTime || "").localeCompare(String(b.createTime || "")));
    return pairMessages(ordered.map((raw) => ({
      role: String(raw.sender || "").toLowerCase() === "assistant" ? "assistant" : "user",
      text: raw.message || "",
      createTime: raw.createTime || ""
    })));
  }

  async function chatgptToken() {
    const session = await httpJson("https://chatgpt.com/api/auth/session");
    return session.accessToken || "";
  }

  async function chatgptGet(path) {
    const token = await chatgptToken();
    const headers = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    return httpJson(`https://chatgpt.com${path}`, { headers });
  }

  async function chatgptSessions(limit) {
    const data = await chatgptGet(`/backend-api/conversations?offset=0&limit=${limit}&order=updated`);
    return (data.items || []).slice(0, limit).map((item) => ({
      conversationId: item.id,
      title: item.title || item.id
    }));
  }

  function chatgptActivePath(mapping, currentNode) {
    if (currentNode && mapping[currentNode]) {
      const chain = [];
      const guard = new Set();
      let cursor = currentNode;
      while (typeof cursor === "string" && mapping[cursor] && !guard.has(cursor)) {
        guard.add(cursor);
        const node = mapping[cursor];
        if (node.message) chain.push(node.message);
        cursor = node.parent ?? null;
      }
      return chain.reverse();
    }
    return Object.values(mapping || {}).map((node) => node.message).filter(Boolean);
  }

  async function chatgptAsks(id) {
    const detail = await chatgptGet(`/backend-api/conversation/${encodeURIComponent(id)}`);
    const ordered = chatgptActivePath(detail.mapping || {}, detail.current_node);
    const messages = [];
    for (const raw of ordered) {
      const role = raw.author && raw.author.role;
      if (role !== "user" && role !== "assistant") continue;
      const parts = ((raw.content && raw.content.parts) || []).filter((part) => typeof part === "string" && part.trim());
      if (!parts.length) continue;
      const seconds = raw.create_time;
      messages.push({
        role,
        text: parts.join("\n"),
        createTime: typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : ""
      });
    }
    return pairMessages(messages);
  }

  async function geminiSessions(limit) {
    const payload = await batchExecute(
      "https://gemini.google.com/_/BardChatUi/data/batchexecute",
      "MaZiqc",
      [limit, null, [0, null, 1]]
    );
    return asArray(at(payload, 2)).slice(0, limit).map((item) => ({
      conversationId: asString(at(item, 0)),
      title: asString(at(item, 1)) || asString(at(item, 0))
    })).filter((item) => item.conversationId);
  }

  function geminiTurnTime(turn) {
    const seconds = at(at(turn, 4), 0);
    if (typeof seconds !== "number") return "";
    return new Date(seconds * 1000).toISOString();
  }

  function firstLongString(node, depth, skip) {
    if (depth > 6 || node == null) return "";
    if (typeof node === "string") {
      const text = node.trim();
      if (text.length > 1 && text !== skip && !/^c_|^r_|^rc_/.test(text)) return text;
      return "";
    }
    if (!Array.isArray(node)) return "";
    for (const child of node) {
      const found = firstLongString(child, depth + 1, skip);
      if (found) return found;
    }
    return "";
  }

  async function geminiAsks(id) {
    const cid = id.startsWith("c_") ? id : `c_${id}`;
    const allTurns = [];
    const seen = new Set();
    let pageToken = null;
    for (let page = 0; page < 20; page++) {
      const payload = await batchExecute(
        "https://gemini.google.com/_/BardChatUi/data/batchexecute",
        "hNvQHb",
        [cid, 100, pageToken, 1, [0], [4], null, 1]
      );
      const turns = asArray(at(payload, 0));
      for (const turn of turns) {
        const key = asString(at(at(turn, 0), 1)) || JSON.stringify(turn).slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        allTurns.push(turn);
      }
      pageToken = asString(at(payload, 1));
      if (!pageToken || !turns.length) break;
    }
    allTurns.sort((a, b) => {
      const ta = at(at(a, 4), 0);
      const tb = at(at(b, 4), 0);
      return (typeof ta === "number" ? ta : 0) - (typeof tb === "number" ? tb : 0);
    });
    const messages = [];
    for (const turn of allTurns) {
      let userText = asString(at(at(at(turn, 2), 0), 0));
      if (!userText) userText = firstLongString(at(turn, 2), 0, cid);
      if (userText) messages.push({ role: "user", text: userText, createTime: "" });
      const candidates = asArray(at(at(turn, 3), 0));
      const selectedId = asString(at(at(turn, 3), 3));
      const chosen = candidates.find((c) => asString(at(c, 0)) === selectedId) || candidates[0];
      let markdown = asString(at(at(chosen, 1), 0));
      if (!markdown) markdown = firstLongString(chosen || at(turn, 3), 0, cid);
      if (markdown) messages.push({ role: "assistant", text: markdown, createTime: geminiTurnTime(turn) });
    }
    return pairMessages(messages);
  }

  const NOTEBOOK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function notebookRows(payload) {
    const rows = [];
    const seen = new Set();
    const visit = (node, depth) => {
      if (!Array.isArray(node) || depth > 5) return;
      const id = asString(at(node, 2));
      const title = asString(at(node, 0));
      if (id && NOTEBOOK_ID_RE.test(id) && title && !NOTEBOOK_ID_RE.test(title) && !seen.has(id)) {
        seen.add(id);
        rows.push({ conversationId: id, title: title.replace(/^thought\n/, "").trim() });
        return;
      }
      for (const child of node) visit(child, depth + 1);
    };
    visit(payload, 0);
    return rows;
  }

  function firstUuid(payload, skip) {
    let found = "";
    const visit = (node, depth) => {
      if (found || depth > 6) return;
      if (typeof node === "string" && NOTEBOOK_ID_RE.test(node) && node !== skip) { found = node; return; }
      if (!Array.isArray(node)) return;
      for (const child of node) visit(child, depth + 1);
    };
    visit(payload, 0);
    return found;
  }

  function notebookAnswerText(block) {
    const direct = asString(at(at(block, 0), 0));
    if (direct) return direct;
    let found = "";
    const visit = (node, depth) => {
      if (found || depth > 5) return;
      if (typeof node === "string" && node.trim().length > 1 && !NOTEBOOK_ID_RE.test(node)) { found = node; return; }
      if (!Array.isArray(node)) return;
      for (const child of node) visit(child, depth + 1);
    };
    visit(block, 0);
    return found;
  }

  async function notebookSessions(limit) {
    const origin = location.origin;
    const payload = await batchExecute(`${origin}/_/LabsTailwindUi/data/batchexecute`, "wXbhsf", [null, 1, null, [2]], "/");
    return notebookRows(payload).slice(0, limit);
  }

  async function notebookAsks(id) {
    const origin = location.origin;
    const base = `${origin}/_/LabsTailwindUi/data/batchexecute`;
    let conversationId = "";
    try {
      conversationId = firstUuid(await batchExecute(base, "hPTbtc", [[], null, id, 1], `/notebook/${id}`), id);
    } catch { conversationId = ""; }
    if (!conversationId) return [];
    const payload = await batchExecute(base, "khqZz", [[], null, null, conversationId, 200], `/notebook/${id}`);
    const turns = [];
    const visit = (node, depth) => {
      if (!Array.isArray(node) || depth > 6) return;
      const role = at(node, 2);
      const question = at(node, 3);
      const answer = at(node, 4);
      if ((role === 1 && typeof question === "string") || (role === 2 && Array.isArray(answer))) { turns.push(node); return; }
      for (const child of node) if (Array.isArray(child)) visit(child, depth + 1);
    };
    visit(payload, 0);
    const messages = [];
    for (const turn of turns.reverse()) {
      const role = at(turn, 2);
      const text = role === 1 ? asString(at(turn, 3)) : notebookAnswerText(at(turn, 4));
      if (!text) continue;
      messages.push({ role: role === 1 ? "user" : "assistant", text, createTime: "" });
    }
    return pairMessages(messages);
  }

  async function listSessions(limit) {
    const platform = detectPlatform();
    if (platform === "grok") return grokSessions(limit);
    if (platform === "chatgpt") return chatgptSessions(limit);
    if (platform === "gemini") return geminiSessions(limit);
    if (platform === "notebook") return notebookSessions(limit);
    throw new Error("Unsupported page");
  }

  async function loadAsks(conversationId) {
    const platform = detectPlatform();
    if (platform === "grok") return grokAsks(conversationId);
    if (platform === "chatgpt") return chatgptAsks(conversationId);
    if (platform === "gemini") return geminiAsks(conversationId);
    if (platform === "notebook") return notebookAsks(conversationId);
    throw new Error("Unsupported page");
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

  const pasteTabs = new Map();
  const pasteBodies = new Map();

  function siteLabel() {
    const host = (location.hostname || "grok").split(".")[0] || "grok";
    return host.toUpperCase();
  }

  function tabTitle(meta) {
    const title = (meta && (meta.title || meta.conversationId)) || "untitled";
    return `${siteLabel()} — ${title}`;
  }

  function articleHtml(item, gtz) {
    const askStamp = item.ask.createTime ? formatAt(item.ask.createTime, gtz) : "";
    const ansStamp = item.answer && item.answer.createTime ? formatAt(item.answer.createTime, gtz) : "";
    return `<article>
      <div class="meta"><span>#${item.order} · Ask${askStamp ? " · " + escapeHtml(askStamp) : ""}</span><button type="button" onclick="renderBubble(this)">Render</button></div>
      <div class="ask">${renderRich(item.ask.message || "")}</div>
      <div class="meta"><span>#${item.order} · Answer${ansStamp ? " · " + escapeHtml(ansStamp) : ""}</span><button type="button" onclick="renderBubble(this)">Render</button></div>
      <div class="answer">${renderRich((item.answer && item.answer.message) || "(no answer)")}</div>
    </article>`;
  }

  function pasteHtml(title, articles, auto) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:760px;color:#111;background:#fff}h1{font-size:16px;margin:0 0 16px}article{margin:0 0 20px}.meta{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#666;margin-bottom:4px}.ask,.answer{white-space:pre-wrap;padding:10px 12px;border-radius:12px}.ask{background:#f3f3f3;margin:0 0 8px 15%}.answer{background:#fafafa;margin:0 15% 0 0;border:1px solid #eee}table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#eee}button{border:1px solid #ccc;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}
.export-html-btn{display:block;width:100%;box-sizing:border-box;margin:0 0 16px;padding:10px 14px;border:0;border-radius:8px;background:#2457a7;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.export-html-btn.bottom{margin:16px 0 0}
.export-html-btn:hover{filter:brightness(1.12)}</style>
<script>
function saveFilename(){
  var title=(document.title||"past-asks").replace(/[\\\\/:*?"<>|]+/g,"-").replace(/\\s+/g," ").trim();
  var orders=[];
  document.querySelectorAll("#pairs article .meta span").forEach(function(node){
    var match=(node.textContent||"").match(/^#(\\d+)\\s*[·-]\\s*Ask/);
    if(match) orders.push(Number(match[1]));
  });
  orders=Array.from(new Set(orders)).sort(function(a,b){return a-b;});
  var range="";
  if(orders.length){
    var start=orders[0],end=start,parts=[];
    for(var i=1;i<orders.length;i++){
      if(orders[i]===end+1){end=orders[i];continue;}
      parts.push(start===end?String(start):start+"-"+end);
      start=end=orders[i];
    }
    parts.push(start===end?String(start):start+"-"+end);
    range=" - Ask "+parts.join(",");
  }
  return (title||"past-asks")+range+".html";
}
function currentHtml(){
  return "<!doctype html>\\n"+document.documentElement.outerHTML;
}
function downloadHtml(){
  try{
    var blob=new Blob([currentHtml()],{type:"text/html;charset=utf-8"});
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a");
    a.href=url;
    a.download=saveFilename();
    a.style.display="none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },1500);
  }catch(err){
    alert("Download failed: "+(err&&err.message||err));
  }
}
function savePage(){ downloadHtml(); }
document.addEventListener("keydown",function(e){
  if((e.ctrlKey||e.metaKey)&& (e.key==="s"||e.key==="S")){
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    savePage();
  }
},true);
window.addEventListener("load",function(){
  if(${auto ? "true" : "false"}){
    document.querySelectorAll("button:not(.export-html-btn)").forEach(function(btn){renderBubble(btn)});
  }
});
window.MathJax={tex:{inlineMath:[["$","$"],["\\\\(","\\\\)"]],displayMath:[["$$","$$"],["\\\\[","\\\\]"]]},startup:{typeset:false}};
function ensureMathJax(){if(window.MathJax&&window.MathJax.typesetPromise&&window.MathJax.startup&&window.MathJax.startup.promise)return window.MathJax.startup.promise;if(window.__mjLoading)return window.__mjLoading;window.__mjLoading=new Promise(function(resolve,reject){var s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";s.async=true;s.onload=function(){resolve(window.MathJax.startup.promise)};s.onerror=reject;document.head.appendChild(s)});return window.__mjLoading}
function renderBubble(btn){var block=btn.parentElement.nextElementSibling;if(!block)return;btn.disabled=true;btn.textContent="Rendering…";ensureMathJax().then(function(){return window.MathJax.typesetPromise([block])}).then(function(){btn.textContent="Rendered"}).catch(function(){btn.disabled=false;btn.textContent="Render failed"})}
<\/script>
</head><body><button type="button" class="export-html-btn" onclick="downloadHtml()">Export / Download this page as HTML</button><h1>${escapeHtml(title)}</h1><div id="pairs">${articles.join("")}</div><button type="button" class="export-html-btn bottom" onclick="downloadHtml()">Export / Download this page as HTML</button></body></html>`;
  }

  function openPaste(meta, auto) {
    const key = (meta && meta.conversationId) || "default";
    const title = tabTitle(meta);
    const html = pasteHtml(title, pasteBodies.get(key) || [], auto);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const tab = window.open(url, `grok-past-asks-${key}`);
    if (!tab) {
      URL.revokeObjectURL(url);
      alert("Popup blocked. Allow popups for this site and try Jump to again.");
      return false;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    pasteTabs.set(key, tab);
    return true;
  }

  function appendPair(item, gtz, meta) {
    const key = (meta && meta.conversationId) || "default";
    const list = pasteBodies.get(key) || [];
    list.push(articleHtml(item, gtz));
    pasteBodies.set(key, list);
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

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;");
  }

  function splitCells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  function isTableRow(line) {
    return /^\s*\|.*\|\s*$/.test(line);
  }

  function isSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/.test(line);
  }

  function tableHtml(rows) {
    const head = splitCells(rows[0]);
    const body = rows.slice(2).map(splitCells);
    const th = head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
    const tr = body.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  }

  function renderRich(text) {
    const lines = String(text || "").split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      if (isTableRow(lines[i]) && isSeparator(lines[i + 1] || "")) {
        const rows = [lines[i], lines[i + 1]];
        i += 2;
        while (i < lines.length && isTableRow(lines[i])) {
          rows.push(lines[i]);
          i += 1;
        }
        out.push(tableHtml(rows));
        continue;
      }
      out.push(escapeHtml(lines[i]) + "\n");
      i += 1;
    }
    return out.join("");
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

  function rangeMax(ranges) {
    return ranges.reduce((max, pair) => Math.max(max, pair[1]), 0);
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
    const title = el("div", { fontSize: "15px", fontWeight: "600" }, { text: "Past asks" });
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
    const listRangeRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" });
    const listRangeInput = el("input", {
      flex: "1",
      padding: "6px 8px",
      border: "1px solid #ccc",
      borderRadius: "6px"
    });
    listRangeInput.type = "text";
    listRangeInput.value = "1-10,11-30";
    listRangeInput.placeholder = "1-10,11-30";
    const listRefresh = el("button", {
      border: "1px solid #ccc",
      background: "#fff",
      borderRadius: "8px",
      padding: "4px 10px",
      cursor: "pointer"
    }, { text: "List refresh" });
    listRefresh.type = "button";
    listRangeRow.append(el("span", { fontWeight: "600" }, { text: "List" }), listRangeInput, listRefresh);
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
    rangeRow.append(el("span", { fontWeight: "600" }, { text: "Asks" }), rangeInput);
    const status = el("div", { color: "#666", marginBottom: "8px" }, { text: "Loading sessions…" });
    const list = el("div");
    panel.append(header, gtzRow, listRangeRow, rangeRow, status, list);
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
      items.forEach((meta, index) => {
        const row = el("div", {
          display: "flex",
          gap: "8px",
          alignItems: "center",
          padding: "8px",
          borderBottom: "1px solid #eee"
        });
        const label = el("div", { flex: "1", wordBreak: "break-word" }, { text: `${meta.listIndex}. ${meta.title || meta.conversationId}` });
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
      const renderLabel = el("label", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", cursor: "pointer" });
      const renderAll = el("input", { margin: "0" });
      renderAll.type = "checkbox";
      renderLabel.append(renderAll, el("span", void 0, { text: "Start formulae rendered" }));
      list.append(renderLabel);
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
            const auto = renderAll.checked;
            for (const target of targets) appendPair(target, readGtz(gtzInput), meta);
            openPaste(meta, auto);
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
      const ranges = parseRanges(listRangeInput.value);
      if (!ranges || !ranges.length) {
        status.textContent = "Bad list range. Use 1-10,11-30.";
        return;
      }
      const limit = Math.min(rangeMax(ranges), 100);
      status.textContent = `Loading ${limit} titles…`;
      try {
        const items = await listSessions(limit);
        const picked = items
          .map((meta, index) => Object.assign({}, meta, { listIndex: index + 1 }))
          .filter((meta) => orderInRanges(meta.listIndex, ranges));
        renderSessions(picked);
        status.textContent = `${picked.length} of ${items.length} titles from “${listRangeInput.value}”.`;
      } catch (error) {
        status.textContent = error && error.message ? error.message : String(error);
      }
    }

    listRefresh.addEventListener("click", loadSessions);

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
