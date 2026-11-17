// ==UserScript==
// @name         Grok seen monitor
// @namespace    ai-chat-logger
// @version      0.1.0
// @description  Show Grok ask/answer uid and text: newfound vs already detected
// @match        https://grok.com/*
// @match        https://x.com/i/grok*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  const seen = new Map();
  const box = document.createElement("div");
  box.id = "grok-seen-monitor";
  box.style.cssText = [
    "position:fixed", "top:72px", "right:12px", "z-index:2147483646",
    "width:480px", "max-height:52vh", "overflow:auto",
    "background:rgba(12,16,24,.62)", "color:#f4f4f4",
    "font:12px/1.45 Consolas,monospace", "padding:8px 10px",
    "border:1px solid rgba(255,255,255,.28)", "border-radius:8px"
  ].join(";");
  const bar = document.createElement("div");
  bar.textContent = "grok seen monitor (drag)";
  bar.style.cssText = "cursor:move;font-weight:700;margin-bottom:6px;";
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;white-space:pre-wrap;";
  box.appendChild(bar);
  box.appendChild(pre);
  document.documentElement.appendChild(box);
  let drag = false, dx = 0, dy = 0;
  bar.addEventListener("mousedown", (e) => {
    drag = true;
    dx = e.clientX - box.offsetLeft;
    dy = e.clientY - box.offsetTop;
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    box.style.left = (e.clientX - dx) + "px";
    box.style.top = (e.clientY - dy) + "px";
    box.style.right = "auto";
  });
  window.addEventListener("mouseup", () => { drag = false; });

  function textOf(el) {
    const md = el.querySelector(".response-content-markdown, .markdown, p");
    return ((md || el).innerText || "").replace(/\s+/g, " ").trim();
  }

  function scan() {
    const lines = [];
    document.querySelectorAll("[data-testid='chat-transcript-scroller'] div[id^='response-']").forEach((wrap) => {
      if (!/^response-[0-9a-f-]{8,}$/i.test(wrap.id || "")) return;
      const uid = wrap.id.slice("response-".length);
      const user = wrap.querySelector("[data-testid='user-message']");
      const ans = wrap.querySelector("[data-testid='assistant-message']");
      const el = user || ans;
      if (!el) return;
      const role = user ? "ask" : "ans";
      const text = textOf(el);
      if (!text) return;
      const key = role + "|" + uid;
      const known = seen.has(key);
      if (!known) seen.set(key, text);
      const prefix = known ? "already detected" : "newfound";
      lines.push(prefix + " " + role + " " + uid + " " + text.slice(0, 160));
    });
    pre.textContent = lines.length ? lines.join("\n") : "no response- nodes in transcript";
  }

  setInterval(scan, 600);
  scan();
})();
