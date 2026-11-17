// ==UserScript==
// @name         Closest ancestor editable peek
// @namespace    ai-chat-logger
// @version      0.2.0
// @description  From a hovered button, use the nearest ancestor that contains a text bar
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const KEY = "peek-ratio";
  const SEL = "[contenteditable='true'], textarea, input:not([type]), input[type='text'], input[type='search']";

  function ratio() {
    const raw = (localStorage.getItem(KEY) || "0.05:0.10").trim();
    const m = raw.match(/([0-9.]+)\s*:\s*([0-9.]+)/);
    const x = m ? Number(m[1]) : 0.05;
    const y = m ? Number(m[2]) : 0.10;
    return {
      x: Number.isFinite(x) ? x : 0.05,
      y: Number.isFinite(y) ? y : 0.10
    };
  }

  function barsIn(node) {
    return [...node.querySelectorAll(SEL)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2 && !el.closest("#peek-box");
    });
  }

  function ancestorBar(btn) {
    const b = btn.getBoundingClientRect();
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    let node = btn.parentElement;

    while (node && node !== document.body && node !== document.documentElement) {
      const bars = barsIn(node).filter((el) => !el.contains(btn));

      if (bars.length) {
        let best = bars[0];
        let bestD = Infinity;

        for (const el of bars) {
          const r = el.getBoundingClientRect();
          const x = Math.max(r.left, Math.min(bx, r.right));
          const y = Math.max(r.top, Math.min(by, r.bottom));
          const d = (bx - x) ** 2 + (by - y) ** 2;

          if (d < bestD) {
            bestD = d;
            best = el;
          }
        }

        return { el: best, bx, by };
      }

      node = node.parentElement;
    }

    return { el: null, bx, by };
  }

  function drawCross(bx, by, maxX, maxY) {
    let h = document.getElementById("peek-cross-h");
    let v = document.getElementById("peek-cross-v");

    if (!h) {
      h = document.createElement("div");
      h.id = "peek-cross-h";
      v = document.createElement("div");
      v.id = "peek-cross-v";

      h.style.cssText =
        "position:fixed;z-index:2147483646;background:rgba(255,40,40,.85);pointer-events:none";
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

  function makeDraggable(wrap, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.style.cursor = "move";
    handle.title = "Drag to move this window";

    handle.addEventListener("mousedown", (e) => {
      // Only drag with the left mouse button.
      if (e.button !== 0) return;

      // Do not start dragging from interactive controls.
      if (e.target.closest("input, textarea, button, select")) return;

      dragging = true;

      const r = wrap.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = r.left;
      startTop = r.top;

      // Switch from right/bottom anchoring to left/top positioning.
      wrap.style.left = r.left + "px";
      wrap.style.top = r.top + "px";
      wrap.style.right = "auto";
      wrap.style.bottom = "auto";

      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;

      const left = startLeft + e.clientX - startX;
      const top = startTop + e.clientY - startY;

      // Keep at least part of the window within the viewport.
      const maxLeft = Math.max(0, window.innerWidth - 40);
      const maxTop = Math.max(0, window.innerHeight - 30);

      wrap.style.left = Math.max(0, Math.min(left, maxLeft)) + "px";
      wrap.style.top = Math.max(0, Math.min(top, maxTop)) + "px";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  function showText(text) {
    let wrap = document.getElementById("peek-box");

    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "peek-box";
      wrap.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;" +
        "background:rgba(0,0,0,.35);color:#fff;" +
        "border:1px solid rgba(255,255,255,.4);padding:6px;box-sizing:border-box";

      // Dedicated drag handle.
      const handle = document.createElement("div");
      handle.id = "peek-drag-handle";
      handle.textContent = "⠿ Drag window";
      handle.style.cssText =
        "height:20px;margin-bottom:6px;font:12px sans-serif;" +
        "color:rgba(255,255,255,.75);user-select:none";

      const inp = document.createElement("input");
      inp.placeholder = "0.05:0.10";
      inp.style.cssText =
        "box-sizing:border-box;width:100%;margin-bottom:6px;" +
        "background:rgba(255,255,255,.2);color:#fff;" +
        "border:1px solid rgba(255,255,255,.4)";
      inp.value = localStorage.getItem(KEY) || "0.05:0.10";
      inp.addEventListener("change", () => localStorage.setItem(KEY, inp.value));
      inp.addEventListener("click", (e) => e.stopPropagation());

      const out = document.createElement("textarea");
      out.id = "peek-out";
      out.readOnly = true;
      out.style.cssText =
        "box-sizing:border-box;width:100%;height:70px;" +
        "background:transparent;color:#fff;border:0";

      const aria = document.createElement("div");
      aria.id = "peek-aria";
      aria.style.cssText = "margin-top:6px;white-space:pre-wrap";

      wrap.appendChild(handle);
      wrap.appendChild(inp);
      wrap.appendChild(out);
      wrap.appendChild(aria);
      document.documentElement.appendChild(wrap);

      makeDraggable(wrap, handle);
    }

    document.getElementById("peek-out").value =
      text || "(none in ancestor)";
  }

  function showAria(btn) {
    const el = document.getElementById("peek-aria");
    if (!el) return;

    const name = btn && (btn.getAttribute("aria-label") || "");
    el.textContent = "from aria-label: " + (name || "(none)");
  }

  showText("");

  document.addEventListener("mousemove", (e) => {
    const btn = e.target.closest &&
      e.target.closest("button, ytcp-button, [role='button']");

    if (!btn || (btn.closest && btn.closest("#peek-box"))) {
      const h = document.getElementById("peek-cross-h");
      const v = document.getElementById("peek-cross-v");
      if (h) h.remove();
      if (v) v.remove();
      return;
    }

    const lim = ratio();
    const hit = ancestorBar(btn);

    drawCross(
      hit.bx,
      hit.by,
      lim.x * window.innerWidth,
      lim.y * window.innerHeight
    );

    showText(hit.el && (hit.el.value || hit.el.innerText));
    showAria(btn);
  }, true);
})();