// ==UserScript==
// @name         Nearest editable peek
// @namespace    ai-chat-logger
// @version      0.2.0
// @description  Show nearest input, textarea, or contenteditable within a stored viewport ratio, and draw the cross
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const KEY = "peek-ratio";

  function ratio() {
    const raw = (localStorage.getItem(KEY) || "0.05:0.10").trim();
    const m = raw.match(/([0-9.]+)\s*:\s*([0-9.]+)/);
    const x = m ? Number(m[1]) : 0.05;
    const y = m ? Number(m[2]) : 0.10;
    return { raw, x: Number.isFinite(x) ? x : 0.05, y: Number.isFinite(y) ? y : 0.10 };
  }

  function pointBoxDist(bx, by, r) {
    const x = Math.max(r.left, Math.min(bx, r.right));
    const y = Math.max(r.top, Math.min(by, r.bottom));
    return { dx: Math.abs(bx - x), dy: Math.abs(by - y) };
  }

  function nearestEditable(btn, lim) {
    const b = btn.getBoundingClientRect();
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const maxX = lim.x * window.innerWidth;
    const maxY = lim.y * window.innerHeight;
    let best = null;
    let bestD = Infinity;
    const sel = "[contenteditable='true'], textarea, input:not([type]), input[type='text'], input[type='search']";
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const g = pointBoxDist(bx, by, r);
      if (g.dx > maxX || g.dy > maxY) continue;
      const d = g.dx * g.dx + g.dy * g.dy;
      if (d < bestD) { bestD = d; best = el; }
    }
    return { el: best, bx, by, maxX, maxY };
  }

  function drawCross(bx, by, maxX, maxY) {
    let h = document.getElementById("peek-cross-h");
    let v = document.getElementById("peek-cross-v");
    if (!h) {
      h = document.createElement("div");
      h.id = "peek-cross-h";
      v = document.createElement("div");
      v.id = "peek-cross-v";
      h.style.cssText = "position:fixed;z-index:2147483646;background:rgba(255,40,40,.85);pointer-events:none";
      v.style.cssText = h.style.cssText;
      document.documentElement.appendChild(h);
      document.documentElement.appendChild(v);
    }
    h.style.left = (bx - maxX) + "px";
    h.style.top = by + "px";
    h.style.width = (maxX * 2) + "px";
    h.style.height = "2px";
    v.style.left = bx + "px";
    v.style.top = (by - maxY) + "px";
    v.style.width = "2px";
    v.style.height = (maxY * 2) + "px";
  }

  function showText(text) {
    let wrap = document.getElementById("peek-box");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "peek-box";
      wrap.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;background:rgba(0,0,0,.35);color:#fff;border:1px solid rgba(255,255,255,.4);padding:6px";
      const inp = document.createElement("input");
      inp.id = "peek-ratio-input";
      inp.placeholder = "0.05:0.10";
      inp.style.cssText = "width:100%;margin-bottom:6px;background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4)";
      inp.value = localStorage.getItem(KEY) || "0.05:0.10";
      inp.addEventListener("change", () => localStorage.setItem(KEY, inp.value));
      inp.addEventListener("click", (e) => e.stopPropagation());
      const out = document.createElement("textarea");
      out.id = "peek-out";
      out.readOnly = true;
      out.style.cssText = "width:100%;height:100px;background:transparent;color:#fff;border:0";
      wrap.appendChild(inp);
      wrap.appendChild(out);
      document.documentElement.appendChild(wrap);
    }
    document.getElementById("peek-out").value = text || "(none in range)";
    clearTimeout(wrap._t);
    clearTimeout(wrap._t);
  }

  showText("");
  document.addEventListener("mousemove", (e) => {
    const btn = e.target.closest && e.target.closest("button, ytcp-button, [role='button']");
    if (!btn) {
      const h = document.getElementById("peek-cross-h");
      const v = document.getElementById("peek-cross-v");
      if (h) h.remove();
      if (v) v.remove();
      return;
    }
    const lim = ratio();
    const hit = nearestEditable(btn, lim);
    drawCross(hit.bx, hit.by, hit.maxX, hit.maxY);
    showText(hit.el && (hit.el.value || hit.el.innerText));
  }, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("#peek-box")) return;
    const btn = e.target.closest("button, ytcp-button, [role='button']");
    if (!btn) return;
    const lim = ratio();
    const hit = nearestEditable(btn, lim);
    const text = hit.el && (hit.el.value || hit.el.innerText);
    showText(text);
  }, true);
})();
