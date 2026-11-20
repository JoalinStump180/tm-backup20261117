// ==UserScript==
// @name         AI Chat Exporter
// @namespace    local.ai-chat-exporter
// @version      0.1.0
// @description  Wanda-style export with a 2-step wizard: range, then pick sessions by title. Grok + ChatGPT (Gemini list-only / current tab).
// @author       local
// @match        https://grok.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const host = location.hostname;
  const platform =
    host.includes("gemini") ? "gemini" :
    host.includes("grok") ? "grok" :
    (host.includes("chatgpt") || host.includes("openai")) ? "chatgpt" :
    null;
  if (!platform) return;

  const STYLE = `
    #ace-fab {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483600;
      font: 13px/1.3 "Segoe UI", sans-serif; background: #111; color: #fff;
      border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.25);
    }
    #ace-wiz {
      position: fixed; right: 16px; bottom: 56px; z-index: 2147483600;
      width: 440px; max-height: min(72vh, 640px); display: flex; flex-direction: column;
      background: #fff; color: #222; border: 1px solid #bbb; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,.28); font: 13px/1.4 "Segoe UI", sans-serif;
    }
    #ace-wiz header, #ace-wiz footer {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid #ddd; background: #f7f7f7;
    }
    #ace-wiz footer { border-bottom: 0; border-top: 1px solid #ddd; }
    #ace-wiz header b { flex: 1; }
    #ace-wiz .body { padding: 12px; overflow: auto; flex: 1; }
    #ace-wiz .hint { color: #666; font-size: 12px; margin: 6px 0 0; }
    #ace-wiz input[type="text"] { width: 88px; height: 26px; }
    #ace-wiz button { font: 13px "Segoe UI", sans-serif; padding: 4px 10px; cursor: pointer; }
    #ace-wiz .item {
      display: grid; grid-template-columns: auto 1fr auto; gap: 8px;
      padding: 8px 0; border-bottom: 1px solid #eee; align-items: start;
    }
    #ace-wiz .title { word-break: break-word; }
    #ace-wiz .url { color: #666; font-size: 11px; }
    #ace-wiz .st { min-width: 110px; text-align: right; font-size: 12px; color: #444; }
    #ace-wiz .st.ok { color: #0a7; }
    #ace-wiz .st.err { color: #c22; }
    #ace-wiz .st.run { color: #06c; }
  `;

  const style = document.createElement("style");
  style.textContent = STYLE;
  (document.head || document.documentElement).appendChild(style);

  const fab = document.createElement("button");
  fab.id = "ace-fab";
  fab.type = "button";
  fab.textContent = "Export chats";
  document.documentElement.appendChild(fab);

  let wiz = null;
  let step = 1;
  let rangeFrom = 1;
  let rangeTo = 10;
  let sessions = [];
  let token = "";

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[c]
    ));
  }

  function parseRange(s) {
    const m = String(s || "1:10").trim().match(/^(\d+)\s*:\s*(\d+)$/);
    if (!m) return { from: 1, to: 10 };
    const a = Math.max(1, parseInt(m[1], 10));
    const b = Math.max(a, parseInt(m[2], 10));
    return { from: a, to: b };
  }

  function download(name, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function roleLabel(role) {
    const r = String(role || "").toLowerCase();
    if (r === "user" || r === "human" || r === "ask") return "User";
    if (r === "assistant" || r === "grok" || r === "bot" || r === "answer") return "Assistant";
    return role || "Message";
  }

  function toMarkdown(pack) {
    const lines = [
      "# " + (pack.title || pack.id || "chat"),
      "",
      "- platform: " + platform,
      "- id: " + (pack.id || ""),
      "- url: " + (pack.url || ""),
      ""
    ];
    for (const t of pack.turns || []) {
      lines.push("## " + roleLabel(t.role));
      if (t.responseId) lines.push("", "_id:_ `" + t.responseId + "`");
      lines.push("", t.text || "", "");
    }
    return lines.join("\n");
  }

  function grokRoleOf(sender) {
    const s = String(sender || "").toLowerCase();
    if (s === "human" || s === "user") return "user";
    return "assistant";
  }

  async function listGrok(limit) {
    const out = [];
    let pageToken;
    while (out.length < limit) {
      const url = new URL("https://grok.com/rest/app-chat/conversations");
      url.searchParams.set("pageSize", String(Math.min(30, limit - out.length)));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error("grok list " + res.status);
      const data = await res.json();
      for (const c of data.conversations || []) {
        if (!c.conversationId) continue;
        out.push({
          id: c.conversationId,
          title: c.title || "(untitled)",
          updatedAt: c.modifyTime || c.createTime || "",
          url: "https://grok.com/c/" + c.conversationId
        });
        if (out.length >= limit) break;
      }
      pageToken = data.nextPageToken || undefined;
      if (!pageToken) break;
    }
    return out;
  }

  async function fetchGrok(id) {
    const enc = encodeURIComponent(id);
    const opt = { credentials: "include", headers: { accept: "application/json" } };
    const detailRes = await fetch("https://grok.com/rest/app-chat/conversations_v2/" + enc, opt);
    if (!detailRes.ok) throw new Error("conversations_v2 " + detailRes.status);
    const detail = await detailRes.json();
    const nodeRes = await fetch("https://grok.com/rest/app-chat/conversations/" + enc + "/response-node", opt);
    if (!nodeRes.ok) throw new Error("response-node " + nodeRes.status);
    const nodes = ((await nodeRes.json()).responseNodes || []);
    const responseIds = [...new Set(nodes.map((n) => n.responseId).filter(Boolean))];
    const loadRes = await fetch("https://grok.com/rest/app-chat/conversations/" + enc + "/load-responses", {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ responseIds })
    });
    if (!loadRes.ok) throw new Error("load-responses " + loadRes.status);
    const loaded = await loadRes.json();
    const byId = new Map((loaded.responses || []).map((r) => [r.responseId, r]));
    const turns = [];
    for (const rid of responseIds) {
      const r = byId.get(rid);
      if (!r) continue;
      const text = String(r.message || "").trim();
      if (!text) continue;
      const created = r.createTime ? Date.parse(r.createTime) : Date.now();
      turns.push({
        role: grokRoleOf(r.sender),
        text,
        responseId: rid,
        ts: Number.isFinite(created) ? created : Date.now()
      });
    }
    const conv = detail.conversation || detail || {};
    return { id, title: conv.title || document.title, url: "https://grok.com/c/" + id, turns };
  }

  async function listChatGPT(limit) {
    const sess = await fetch("https://chatgpt.com/api/auth/session", {
      credentials: "include",
      headers: { accept: "application/json" }
    }).then((r) => r.json());
    token = sess && sess.accessToken;
    if (!token) throw new Error("no ChatGPT accessToken");
    const out = [];
    let offset = 0;
    while (out.length < limit) {
      const url = new URL("https://chatgpt.com/backend-api/conversations");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(Math.min(28, limit - out.length)));
      url.searchParams.set("order", "updated");
      const res = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json", authorization: "Bearer " + token }
      });
      if (!res.ok) throw new Error("chatgpt list " + res.status);
      const data = await res.json();
      const items = data.items || [];
      for (const it of items) {
        if (!it.id) continue;
        out.push({
          id: it.id,
          title: it.title || "(untitled)",
          updatedAt: it.update_time || "",
          url: "https://chatgpt.com/c/" + it.id
        });
        if (out.length >= limit) break;
      }
      if (!items.length) break;
      offset += items.length;
    }
    return out;
  }

  function chatgptMessageText(msg) {
    const content = msg && msg.content;
    if (!content) return "";
    if (typeof content === "string") return content;
    const parts = content.parts || [];
    return parts.map((p) => (typeof p === "string" ? p : (p && p.text) || "")).join("\n");
  }

  async function fetchChatGPT(id) {
    const res = await fetch("https://chatgpt.com/backend-api/conversation/" + encodeURIComponent(id), {
      credentials: "include",
      headers: { accept: "application/json", authorization: "Bearer " + token }
    });
    if (!res.ok) throw new Error("chatgpt conversation " + res.status);
    const data = await res.json();
    const mapping = data.mapping || {};
    const nodes = Object.values(mapping).sort((a, b) => {
      const ta = (a.message && a.message.create_time) || 0;
      const tb = (b.message && b.message.create_time) || 0;
      return ta - tb;
    });
    const turns = [];
    for (const node of nodes) {
      const msg = node && node.message;
      if (!msg) continue;
      const role = msg.author && msg.author.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = chatgptMessageText(msg).trim();
      if (!text) continue;
      turns.push({
        role,
        text,
        responseId: msg.id || node.id || "",
        ts: msg.create_time ? Math.round(msg.create_time * 1000) : Date.now()
      });
    }
    return { id, title: data.title || document.title, url: "https://chatgpt.com/c/" + id, turns };
  }

  function scrapeGeminiDom() {
    const asks = [...document.querySelectorAll("user-query, .query-text, .user-query")];
    const answers = [...document.querySelectorAll("model-response, .model-response, .response-content")];
    const turns = [];
    const n = Math.max(asks.length, answers.length);
    for (let i = 0; i < n; i++) {
      if (asks[i]) {
        const text = (asks[i].innerText || "").trim();
        if (text) turns.push({ role: "user", text, responseId: "ask-" + i, ts: Date.now() });
      }
      if (answers[i]) {
        const text = (answers[i].innerText || "").trim();
        if (text) turns.push({ role: "assistant", text, responseId: "ans-" + i, ts: Date.now() });
      }
    }
    const m = location.pathname.match(/\/app\/([^/?#]+)/);
    return {
      id: (m && m[1]) || "current",
      title: document.title,
      url: location.href,
      turns
    };
  }

  async function listSessions(to) {
    if (platform === "grok") return listGrok(to);
    if (platform === "chatgpt") return listChatGPT(to);
    if (platform === "gemini") {
      const cur = scrapeGeminiDom();
      return [{ id: cur.id, title: cur.title || "current Gemini tab", url: cur.url, currentOnly: true }];
    }
    throw new Error("unsupported site");
  }

  async function fetchSession(row) {
    if (platform === "grok") return fetchGrok(row.id);
    if (platform === "chatgpt") return fetchChatGPT(row.id);
    if (platform === "gemini") return scrapeGeminiDom();
    throw new Error("unsupported site");
  }

  function closeWiz() {
    if (wiz) wiz.remove();
    wiz = null;
  }

  function paintStep1() {
    wiz.querySelector(".body").innerHTML = `
      <div>Site: <b>${esc(platform)}</b></div>
      <p>Step 1 — newest session range (1-based), same idea as Wanda’s range box.</p>
      <label>Range <input id="ace-range" type="text" value="${rangeFrom}:${rangeTo}" /></label>
      <p class="hint">Example 1:10 = ten newest chats. Next window lists their titles.</p>
    `;
    wiz.querySelector("#ace-next").textContent = "Next";
    wiz.querySelector("#ace-next").disabled = false;
    wiz.querySelector("#ace-all").hidden = true;
  }

  function paintStep2() {
    const rows = sessions.map((s, i) => `
      <div class="item" data-i="${i}">
        <label><input type="checkbox" class="ace-ck" ${s.on ? "checked" : ""} /></label>
        <div>
          <div class="title">${esc(s.n + ". " + (s.title || s.id))}</div>
          <div class="url">${esc(s.url || s.id)}</div>
        </div>
        <div class="st ${s.cls || ""}" id="ace-st-${i}">${esc(s.status || "ready")}</div>
      </div>`).join("") || "<div>No sessions in this range.</div>";
    wiz.querySelector(".body").innerHTML = `
      <p>Step 2 — choose which sessions to download (JSON + Markdown).</p>
      ${rows}
    `;
    wiz.querySelectorAll(".ace-ck").forEach((ck, i) => {
      ck.addEventListener("change", () => { sessions[i].on = ck.checked; });
    });
    wiz.querySelector("#ace-next").textContent = "Download selected";
    wiz.querySelector("#ace-next").disabled = !sessions.length;
    wiz.querySelector("#ace-all").hidden = false;
  }

  function setStatus(i, text, cls) {
    sessions[i].status = text;
    sessions[i].cls = cls || "";
    const el = document.getElementById("ace-st-" + i);
    if (el) {
      el.textContent = text;
      el.className = "st " + (cls || "");
    }
  }

  async function runExport() {
    const chosen = sessions.map((s, i) => ({ s, i })).filter((x) => x.s.on);
    if (!chosen.length) return;
    wiz.querySelector("#ace-next").disabled = true;
    const bundle = { platform, exportedAt: new Date().toISOString(), sessions: [] };
    let mdAll = "# AI Chat Exporter\n\nplatform: " + platform + "\n\n";
    for (const { s, i } of chosen) {
      setStatus(i, "fetching…", "run");
      try {
        const pack = await fetchSession(s);
        pack.id = pack.id || s.id;
        bundle.sessions.push(pack);
        mdAll += toMarkdown(pack) + "\n\n---\n\n";
        download(safeName(pack.title || pack.id) + ".md", toMarkdown(pack), "text/markdown");
        setStatus(i, "ok  " + (pack.turns || []).length + " turns", "ok");
      } catch (err) {
        setStatus(i, "error: " + err.message, "err");
      }
    }
    download("ai-chat-export-" + platform + ".json", JSON.stringify(bundle, null, 2), "application/json");
    download("ai-chat-export-" + platform + ".md", mdAll, "text/markdown");
    wiz.querySelector("#ace-next").disabled = false;
    wiz.querySelector("#ace-next").textContent = "Download selected";
  }

  function safeName(s) {
    return String(s || "chat").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  }

  function openWiz() {
    closeWiz();
    step = 1;
    wiz = document.createElement("div");
    wiz.id = "ace-wiz";
    wiz.innerHTML = `
      <header>
        <b>AI Chat Exporter</b>
        <button type="button" id="ace-x">Close</button>
      </header>
      <div class="body"></div>
      <footer>
        <button type="button" id="ace-all" hidden>Select all / none</button>
        <span style="flex:1"></span>
        <button type="button" id="ace-next">Next</button>
      </footer>
    `;
    document.documentElement.appendChild(wiz);
    wiz.querySelector("#ace-x").onclick = closeWiz;
    let allOn = true;
    wiz.querySelector("#ace-all").onclick = () => {
      allOn = !sessions.every((s) => s.on);
      sessions.forEach((s) => { s.on = allOn; });
      paintStep2();
    };
    wiz.querySelector("#ace-next").onclick = async () => {
      if (step === 1) {
        const r = parseRange(wiz.querySelector("#ace-range").value);
        rangeFrom = r.from;
        rangeTo = r.to;
        wiz.querySelector("#ace-next").disabled = true;
        wiz.querySelector(".body").innerHTML = "<p>Listing sessions…</p>";
        try {
          const rows = await listSessions(rangeTo);
          const sliced = rows.slice(rangeFrom - 1, rangeTo);
          sessions = sliced.map((row, idx) => ({
            ...row,
            n: rangeFrom + idx,
            on: true,
            status: row.currentOnly ? "current tab only" : "ready",
            cls: ""
          }));
          step = 2;
          paintStep2();
        } catch (err) {
          wiz.querySelector(".body").innerHTML = "<p class='st err'>List failed: " + esc(err.message) + "</p>";
          wiz.querySelector("#ace-next").disabled = false;
        }
        return;
      }
      await runExport();
    };
    paintStep1();
  }

  fab.onclick = openWiz;
})();
