// ==UserScript==
// @name         Seen bubble monitor  for grok gemini chatgpt
// @namespace    ai-chat-logger
// @version      0.2.0
// @description  Seen-route scan from the logger: uid, SEEN_ONLINE, MAY_INCOMPLETE
// @match        https://grok.com/*
// @match        https://x.com/i/grok*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  const host = location.hostname;
  const platform = host.includes("grok") || host === "x.com" ? "grok" : host.includes("gemini") ? "gemini" : "chatgpt";
  const seenLogged = new Set();
  const seenLast = new Map();
  const lines = [];

  const box = document.createElement("div");
  box.id = "seen-monitor";
  box.style.cssText = "position:fixed;top:72px;right:12px;z-index:2147483646;width:520px;max-height:54vh;overflow:auto;background:rgba(12,16,24,.62);color:#f4f4f4;font:12px/1.45 Consolas,monospace;padding:8px 10px;border:1px solid rgba(255,255,255,.28);border-radius:8px;";
  const bar = document.createElement("div");
  bar.textContent = "seen monitor (drag) " + platform;
  bar.style.cssText = "cursor:move;font-weight:700;margin-bottom:6px;";
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;white-space:pre-wrap;";
  box.appendChild(bar);
  box.appendChild(pre);
  document.documentElement.appendChild(box);
  let drag = false, dx = 0, dy = 0;
  bar.addEventListener("mousedown", (e) => { drag = true; dx = e.clientX - box.offsetLeft; dy = e.clientY - box.offsetTop; });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    box.style.left = (e.clientX - dx) + "px";
    box.style.top = (e.clientY - dy) + "px";
    box.style.right = "auto";
  });
  window.addEventListener("mouseup", () => { drag = false; });

  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function seenPrefix(ts) {
    const d = new Date(ts);
    const z = (n) => String(n).padStart(2, "0");
    return "SEEN_ONLINE: " + d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds()) + " ";
  }
  function note(line) {
    lines.unshift(line);
    pre.textContent = lines.slice(0, 40).join("\n");
  }
  function geminiTurnId(el) {
    const marked = el.querySelector("[id^='message-content-id-r_'], [id^='model-response-message-contentr_']");
    const fromMark = (marked && marked.id || "").match(/r_([0-9a-f]{8,})/i);
    if (fromMark) return "r_" + fromMark[1];
    let n = el;
    for (let i = 0; i < 12 && n; i++) {
      if (/^[0-9a-f]{8,}$/i.test(n.id || "") && n.id !== "chat-history") return "r_" + n.id;
      n = n.parentElement;
    }
    return "";
  }
  function bubbles() {
    const out = [];
    if (platform === "grok") {
      const wraps = document.querySelectorAll("[data-testid='chat-transcript-scroller'] div[id^='response-']");
      const list = wraps.length ? wraps : document.querySelectorAll("div[id^='response-']");
      list.forEach((wrap) => {
        if (!/^response-[0-9a-f-]{8,}$/i.test(wrap.id || "")) return;
        const uid = wrap.id.slice("response-".length);
        const user = wrap.querySelector("[data-testid='user-message']");
        const ans = wrap.querySelector("[data-testid='assistant-message']");
        const el = user || ans;
        if (!el) return;
        const md = el.querySelector(".response-content-markdown, .markdown, p");
        const text = norm(md || el).replace(/^worked for \d+s\s*/i, "");
        if (text) out.push({ role: user ? "user" : "assistant", uid, text });
      });
    } else if (platform === "chatgpt") {
      document.querySelectorAll("[data-message-author-role='user']").forEach((el) => {
        const uid = el.getAttribute("data-message-id") || "";
        const text = norm(el);
        if (uid && text) out.push({ role: "user", uid, text });
      });
      document.querySelectorAll("[data-message-author-role='assistant']").forEach((el) => {
        const uid = el.getAttribute("data-message-id") || "";
        const text = norm(el);
        if (uid && text) out.push({ role: "assistant", uid, text });
      });
    } else {
      document.querySelectorAll("user-query").forEach((el) => {
        const uid = geminiTurnId(el);
        const text = norm(el);
        if (uid && text) out.push({ role: "user", uid, text });
      });
      document.querySelectorAll("model-response").forEach((el) => {
        const body = el.querySelector("message-content, model-response-content") || el;
        const uid = geminiTurnId(el);
        const text = norm(body);
        if (uid && text) out.push({ role: "assistant", uid, text });
      });
    }
    return out;
  }

  function scan() {
    const found = bubbles();
    if (!found.length) { note("scan " + platform + " bubbles=0 " + location.pathname); return; }
    found.forEach((b) => {
      const key = b.role + "|" + b.uid;
      if (seenLogged.has(key)) {
        note("already detected " + (b.role === "user" ? "ask" : "ans") + " " + b.uid);
        return;
      }
      if (b.role !== "user") {
        const prev = seenLast.get(key);
        seenLast.set(key, b.text);
        if (prev == null) return;
        const prefix = seenPrefix(Date.now()) + (prev !== b.text ? "MAY_INCOMPLETE " : "");
        seenLogged.add(key);
        note("newfound " + prefix + "ans " + b.uid + " " + b.text.slice(0, 180));
        return;
      }
      seenLogged.add(key);
      note("newfound " + seenPrefix(Date.now()) + "ask " + b.uid + " " + b.text.slice(0, 180));
    });
  }
  setInterval(scan, 600);
  scan();
})();
