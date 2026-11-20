// ==UserScript==
// @name         Copy links in selection (Ctrl+Right-click)
// @namespace    local.copy-links-in-selection
// @version      1.0
// @description  Ctrl+Right-click, or the extra item on the page menu, copies every link inside the highlighted text.
// @match        *://*/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const MENU_ID = "__copy_links_menu__";
  const BAR_ID = "__copy_links_bar__";

  function absUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  function closestLink(node) {
    while (node && node !== document && node !== document.documentElement) {
      if (node.nodeType === 1 && node.tagName === "A" && node.hasAttribute("href")) {
        return node;
      }
      node = node.parentNode || node.parentElement;
    }
    return null;
  }

  function linksInSelection() {
    const sel = window.getSelection();
    const urls = [];
    const seen = new Set();

    function add(href) {
      const u = absUrl(href);
      if (!u || seen.has(u)) return;
      seen.add(u);
      urls.push(u);
    }

    if (!sel || sel.rangeCount === 0 || String(sel).trim() === "") {
      return urls;
    }

    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      const frag = range.cloneContents();
      frag.querySelectorAll("a[href]").forEach((a) => add(a.getAttribute("href")));

      add(closestLink(range.startContainer)?.getAttribute?.("href"));
      add(closestLink(range.endContainer)?.getAttribute?.("href"));
      add(closestLink(range.commonAncestorContainer)?.getAttribute?.("href"));
    }
    return urls;
  }

  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.style.cssText = [
      "position:fixed",
      "top:8px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "max-width:min(90vw,720px)",
      "padding:8px 14px",
      "border-radius:10px",
      "background:rgba(12,12,12,.75)",
      "color:#f3f3f3",
      "font:12px/1.35 Segoe UI,system-ui,sans-serif",
      "pointer-events:none",
      "box-shadow:0 4px 18px rgba(0,0,0,.28)",
    ].join(";");
    document.documentElement.appendChild(bar);
    return bar;
  }

  function toast(main, detail) {
    const bar = ensureBar();
    bar.innerHTML =
      `<div style="font-weight:700;font-size:13px">${escapeHtml(main)}</div>` +
      (detail
        ? `<div style="opacity:.8;margin-top:2px;word-break:break-all">${escapeHtml(detail)}</div>`
        : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      if (bar.parentNode) bar.remove();
    }, 3500);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function copyUrls(urls) {
    const text = urls.join("\n");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function doCopyLinks() {
    const urls = linksInSelection();
    if (!urls.length) {
      toast("no links in selection", "highlight text that contains <a> links, then try again");
      return;
    }
    const ok = await copyUrls(urls);
    toast(
      ok ? `copied ${urls.length} link${urls.length === 1 ? "" : "s"}` : "copy failed",
      urls.slice(0, 6).join("  ·  ") + (urls.length > 6 ? " …" : "")
    );
  }

  function hideMenu() {
    document.getElementById(MENU_ID)?.remove();
  }

  function showMenu(x, y, count) {
    hideMenu();
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.style.cssText = [
      "position:fixed",
      `left:${Math.min(x, window.innerWidth - 260)}px`,
      `top:${Math.min(y, window.innerHeight - 60)}px`,
      "z-index:2147483647",
      "min-width:220px",
      "background:#fff",
      "color:#111",
      "border:1px solid #d0d0d0",
      "border-radius:8px",
      "box-shadow:0 8px 24px rgba(0,0,0,.18)",
      "font:13px/1.4 Segoe UI,system-ui,sans-serif",
      "overflow:hidden",
    ].join(";");

    const item = document.createElement("div");
    item.textContent =
      count > 0
        ? `Copy ${count} link${count === 1 ? "" : "s"} in selection`
        : "Copy links in selection (none found)";
    item.style.cssText =
      "padding:9px 12px;cursor:pointer;" + (count ? "" : "opacity:.45;cursor:default;");
    item.onmouseenter = () => {
      if (count) item.style.background = "#f0f4ff";
    };
    item.onmouseleave = () => {
      item.style.background = "transparent";
    };
    item.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    item.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideMenu();
      if (count) await doCopyLinks();
    };
    menu.appendChild(item);
    document.documentElement.appendChild(menu);
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      const urls = linksInSelection();
      const hasSel = !!(window.getSelection && String(window.getSelection()).trim());

      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        hideMenu();
        doCopyLinks();
        return;
      }

      if (!hasSel) {
        hideMenu();
        return;
      }

      // Keep the browser menu; add our extra item next to the cursor.
      showMenu(e.clientX + 8, e.clientY + 8, urls.length);
    },
    true
  );

  document.addEventListener("click", hideMenu, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });
  window.addEventListener("scroll", hideMenu, true);

 // toast("links-in-selection ready", "select text → Ctrl+Right-click, or use the extra menu item");
})();
