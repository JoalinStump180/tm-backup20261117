// ==UserScript==
// @name         Page text tree
// @namespace    local.page-text-tree
// @version      0.5.5
// @description  Bottom-left button: searchable folded tree of the page's text nodes
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  if (window.top !== window) return;

  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|SVG|PATH|META|LINK)$/i;
  const Z = "2147483647";

  function norm(s) {
    return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function ownText(el) {
    let s = "";
    if (!el || !el.childNodes) return "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.nodeValue;
    }
    return norm(s);
  }

  function parseScope(raw) {
    return String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  function matchesAny(el, sels) {
    if (!el || el.nodeType !== 1 || !sels.length) return false;
    for (const sel of sels) {
      try {
        if (el.matches(sel)) return true;
      } catch (_) {}
    }
    return false;
  }

  function queryDeep(sel, root, out, seen) {
    if (!root || !sel) return;
    try {
      for (const n of root.querySelectorAll(sel)) {
        if (!seen.has(n)) { seen.add(n); out.push(n); }
      }
    } catch (_) {}
    let all;
    try { all = root.querySelectorAll("*"); } catch (_) { return; }
    for (const el of all) {
      if (el.shadowRoot) queryDeep(sel, el.shadowRoot, out, seen);
    }
  }

  function collectTexts(node, parts) {
    if (!node) return;
    if (node.nodeType === 3) {
      const t = norm(node.nodeValue);
      if (t) parts.push(t);
      return;
    }
    if (node.nodeType !== 1 || SKIP.test(node.tagName)) return;
    if (node.id === "ptt-fab" || node.id === "ptt-panel") return;
    if (node.shadowRoot) {
      for (const c of node.shadowRoot.childNodes) collectTexts(c, parts);
    }
    for (const c of node.childNodes) collectTexts(c, parts);
  }

  function isBlockish(el) {
    if (!el || el.nodeType !== 1) return false;
    const t = el.tagName || "";
    if (/^(P|DIV|LI|TR|H[1-6]|BR|HR|SECTION|ARTICLE|BLOCKQUOTE|PRE|UL|OL)$/i.test(t)) return true;
    try {
      const d = el.ownerDocument.defaultView.getComputedStyle(el).display;
      return /^(block|flex|grid|table|list-item)$/.test(d);
    } catch (_) {
      return false;
    }
  }

  function collectVisual(node, parts, pending) {
    if (!node) return;
    if (node.nodeType === 3) {
      const t = String(node.nodeValue || "").replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ");
      if (t) pending.s += t;
      return;
    }
    if (node.nodeType !== 1 || SKIP.test(node.tagName)) return;
    if (node.id === "ptt-fab" || node.id === "ptt-panel") return;
    if (node.tagName === "BR") {
      const line = pending.s.replace(/[ \t]+/g, " ").trim();
      if (line) parts.push(line);
      pending.s = "";
      return;
    }
    const block = isBlockish(node) && node !== pending.root;
    if (block && pending.s) {
      const line = pending.s.replace(/[ \t]+/g, " ").trim();
      if (line) parts.push(line);
      pending.s = "";
    }
    if (node.shadowRoot) {
      for (const c of node.shadowRoot.childNodes) collectVisual(c, parts, pending);
    }
    for (const c of node.childNodes) collectVisual(c, parts, pending);
    if (block && pending.s) {
      const line = pending.s.replace(/[ \t]+/g, " ").trim();
      if (line) parts.push(line);
      pending.s = "";
    }
  }

  function dumpUnit(el) {
    const parts = [];
    const pending = { s: "", root: el };
    collectVisual(el, parts, pending);
    const tail = pending.s.replace(/[ \t]+/g, " ").trim();
    if (tail) parts.push(tail);
    if (parts.length) return parts.join("\n");
    return String(el.innerText || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  }

  function pickLargest(sels) {
    if (!sels.length) return "";
    const groups = [];
    for (const sel of sels) {
      const els = [];
      queryDeep(sel, document, els, new Set());
      groups.push({ sel, els });
    }
    const live = groups.filter((g) => g.els.length);
    if (!live.length) return sels[0] || "";
    function aWrapsB(A, B) {
      if (A.sel === B.sel) return false;
      return B.els.some((b) => A.els.some((a) => a !== b && a.contains && a.contains(b)));
    }
    let max = live.filter((g) => !live.some((h) => aWrapsB(h, g)));
    if (!max.length) max = live;
    max.sort((a, b) => a.els.length - b.els.length);
    return max[0].sel;
  }

  function walk(node, sels, inside, pathPrefix, largest) {
    if (!node) return null;
    if (node.nodeType === 3) {
      if (sels.length && !inside) return null;
      const t = norm(node.nodeValue);
      if (t.length < 1) return null;
      const path = pathPrefix ? pathPrefix + " > #text" : "#text";
      return { tag: "#text", text: t, kids: [], path };
    }
    if (node.nodeType !== 1) return null;
    if (SKIP.test(node.tagName)) return null;
    if (node.id === "ptt-fab" || node.id === "ptt-panel" || node.id === "ptt-style") return null;

    let label = (node.tagName || "node").toLowerCase();
    if (node.id) label += "#" + node.id;
    else {
      const testid = node.getAttribute && node.getAttribute("data-testid");
      if (testid) label += '[data-testid="' + testid + '"]';
    }
    const path = pathPrefix ? pathPrefix + " > " + label : label;
    const isLargest = !!(largest && matchesAny(node, [largest]));
    if (isLargest) {
      return { tag: label, text: dumpUnit(node), kids: [], path, unit: true };
    }
    const nowInside = inside || !sels.length || matchesAny(node, sels);
    const kids = [];
    if (node.shadowRoot) {
      for (const c of node.shadowRoot.childNodes) {
        const k = walk(c, sels, nowInside, path, largest);
        if (k) kids.push(k);
      }
    }
    for (const c of node.childNodes) {
      const k = walk(c, sels, nowInside, path, largest);
      if (k) kids.push(k);
    }
    const text = (!largest && nowInside) ? ownText(node) : "";
    if (!kids.length && !text) return null;
    return { tag: label, text, kids, path };
  }

  function ensureStyle() {
    if (document.getElementById("ptt-style")) return;
    const s = document.createElement("style");
    s.id = "ptt-style";
    s.textContent = `
      #ptt-fab {
        position: fixed !important; left: 16px !important; bottom: 16px !important;
        z-index: ${Z} !important; width: 52px !important; height: 52px !important;
        border-radius: 26px !important; border: 1px solid rgba(255,255,255,.45) !important;
        background: rgba(20,20,20,.45) !important; color: #fff !important;
        font: 20px/52px sans-serif !important; text-align: center !important;
        cursor: pointer !important; backdrop-filter: blur(8px);
        box-shadow: 0 4px 16px rgba(0,0,0,.3) !important;
      }
      #ptt-panel {
        position: fixed !important; left: 16px !important; bottom: 80px !important;
        z-index: ${Z} !important;
        width: min(920px, calc(100vw - 32px)) !important;
        height: min(86vh, 860px) !important;
        background: rgba(18,18,18,.42) !important; color: #f2f2f2 !important;
        border: 1px solid rgba(255,255,255,.28) !important; border-radius: 10px !important;
        display: flex !important; flex-direction: column !important;
        font: 13px/1.4 ui-sans-serif, system-ui, sans-serif !important;
        backdrop-filter: blur(10px) saturate(1.1);
        box-shadow: 0 10px 40px rgba(0,0,0,.35) !important;
      }
      #ptt-panel[hidden] { display: none !important; }
      #ptt-head, #ptt-scope-row {
        display: flex !important; gap: 8px !important; align-items: center !important;
        padding: 8px 10px !important; border-bottom: 1px solid rgba(255,255,255,.15) !important;
        background: rgba(0,0,0,.15) !important;
      }
      #ptt-q, #ptt-scope {
        flex: 1 !important; height: 32px !important; border: 1px solid rgba(255,255,255,.25) !important;
        background: rgba(0,0,0,.28) !important; color: #fff !important;
        padding: 0 10px !important; border-radius: 4px !important;
      }
      #ptt-close, #ptt-rebuild {
        height: 32px !important; border: 1px solid rgba(255,255,255,.25) !important;
        background: rgba(0,0,0,.28) !important; color: #fff !important;
        padding: 0 10px !important; cursor: pointer !important;
      }
      #ptt-meta {
        padding: 6px 10px !important; color: #ddd !important;
        border-bottom: 1px solid rgba(255,255,255,.12) !important;
        background: rgba(0,0,0,.12) !important;
      }
      #ptt-tree { flex: 1 !important; overflow: auto !important; padding: 8px 12px 16px !important; min-height: 120px !important; }
      #ptt-canvas {
        display: block !important;
        width: max-content !important;
        min-width: 3600px !important;
        box-sizing: border-box !important;
      }
      #ptt-picks {
        max-height: 28% !important; overflow: auto !important;
        border-top: 1px solid rgba(255,255,255,.18) !important;
        background: rgba(0,0,0,.18) !important; padding: 6px 8px !important;
      }
      .ptt-pick {
        display: flex !important; align-items: stretch !important; gap: 6px !important; margin: 3px 0 !important;
      }
      .ptt-pick.on { background: rgba(255,210,0,.22) !important; }
      .ptt-n {
        flex: 0 0 44px !important; color: #ffe08a !important; font: 12px/28px ui-monospace, Consolas, monospace !important;
        text-align: right !important; user-select: none !important;
      }
      .ptt-pick input {
        flex: 1 !important; min-width: 0 !important; height: 28px !important;
        border: 1px solid rgba(255,255,255,.25) !important; background: rgba(0,0,0,.35) !important;
        color: #fff !important; padding: 0 8px !important; font: 12px/28px ui-monospace, Consolas, monospace !important;
      }
      .ptt-tag, .ptt-txt { cursor: pointer !important; }
      .ptt-row { display: flex !important; align-items: flex-start !important; gap: 6px !important; margin: 2px 0 !important; }
      .ptt-tog {
        width: 18px !important; height: 18px !important; flex: 0 0 18px !important;
        border: 1px solid rgba(255,255,255,.3) !important; background: rgba(0,0,0,.25) !important;
        color: #fff !important; font: 12px/16px monospace !important; padding: 0 !important; cursor: pointer !important;
      }
      .ptt-tog[disabled] { opacity: .25 !important; cursor: default !important; }
      .ptt-tag { color: #b8e0ff !important; white-space: nowrap !important; }
      #ptt-largest {
        flex: 0 0 auto !important; max-width: 46% !important; color: #ffe08a !important;
        font: 12px/1.3 ui-monospace, Consolas, monospace !important; white-space: nowrap !important;
        overflow: hidden !important; text-overflow: ellipsis !important;
      }
      .ptt-txt { color: #f3f3f3 !important; word-break: normal !important; white-space: pre !important; }
      .ptt-kids { margin-left: 16px !important; border-left: 1px dotted rgba(255,255,255,.25) !important; padding-left: 8px !important; }
      .ptt-kids[hidden] { display: none !important; }
      .ptt-hit .ptt-txt { background: transparent !important; color: #f3f3f3 !important; }
      mark.ptt-mark { background: rgba(255,210,0,.75) !important; color: #111 !important; padding: 0 1px !important; }
      .ptt-openpath > .ptt-row .ptt-tag { color: #ffe08a !important; }
    `;
    (document.documentElement || document.head || document.body).appendChild(s);
  }

  function renderNode(node) {
    const wrap = document.createElement("div");
    wrap.className = "ptt-node";
    const row = document.createElement("div");
    row.className = "ptt-row";
    const tog = document.createElement("button");
    tog.type = "button";
    tog.className = "ptt-tog";
    const hasKids = node.kids && node.kids.length;
    tog.textContent = hasKids ? "+" : "·";
    tog.disabled = !hasKids;
    const tag = document.createElement("span");
    tag.className = "ptt-tag";
    tag.textContent = node.tag;
    const txt = document.createElement("span");
    txt.className = "ptt-txt";
    txt.textContent = node.text ? "  " + node.text : "";
    row.appendChild(tog);
    row.appendChild(tag);
    row.appendChild(txt);
    tag.addEventListener("click", (e) => { e.stopPropagation(); addPick(node); });
    txt.addEventListener("click", (e) => { e.stopPropagation(); addPick(node); });
    wrap.appendChild(row);
    let kidsBox = null;
    if (hasKids) {
      kidsBox = document.createElement("div");
      kidsBox.className = "ptt-kids";
      kidsBox.hidden = true;
      node.kids.forEach((k) => kidsBox.appendChild(renderNode(k)));
      wrap.appendChild(kidsBox);
      tog.addEventListener("click", () => {
        kidsBox.hidden = !kidsBox.hidden;
        tog.textContent = kidsBox.hidden ? "+" : "−";
      });
    }
    wrap._ptt = { node, tog, kidsBox, txt };
    return wrap;
  }

  function searchHay(s) {
    return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function hayMap(original) {
    const src = String(original || "").replace(/\u00a0/g, " ");
    let hay = "";
    const at = [];
    let sp = false;
    for (let i = 0; i < src.length; i++) {
      if (/\s/.test(src[i])) {
        if (hay && !sp) {
          hay += " ";
          at.push(i);
          sp = true;
        }
      } else {
        hay += src[i].toLowerCase();
        at.push(i);
        sp = false;
      }
    }
    let start = 0;
    let end = hay.length;
    while (start < end && hay[start] === " ") start++;
    while (end > start && hay[end - 1] === " ") end--;
    return { hay: hay.slice(start, end), at: at.slice(start, end), src };
  }

  function paintMatch(el, original, q) {
    const prefix = original && String(original).length ? "  " : "";
    const body = String(original || "");
    el.textContent = "";
    if (!q) {
      el.textContent = prefix + body;
      return false;
    }
    const mapped = hayMap(body);
    if (!mapped.hay.includes(q)) {
      el.textContent = prefix + body;
      return false;
    }
    if (prefix) el.appendChild(document.createTextNode(prefix));
    let from = 0;
    let hit = false;
    let idx = mapped.hay.indexOf(q);
    while (idx >= 0) {
      hit = true;
      const a = mapped.at[idx];
      const b = mapped.at[idx + q.length - 1] + 1;
      if (a > from) el.appendChild(document.createTextNode(body.slice(from, a)));
      const mark = document.createElement("mark");
      mark.className = "ptt-mark";
      mark.textContent = body.slice(a, b);
      el.appendChild(mark);
      from = b;
      idx = mapped.hay.indexOf(q, idx + q.length);
    }
    if (from < body.length) el.appendChild(document.createTextNode(body.slice(from)));
    return hit;
  }

  function applySearch(rootEl, q) {
    q = searchHay(q);
    let hits = 0;
    function rec(el) {
      const info = el._ptt;
      if (!info) return false;
      const textHit = paintMatch(info.txt, info.node.text || "", q);
      const tagHit = q && searchHay(info.node.tag).includes(q);
      const selfHit = textHit || tagHit;
      let childHit = false;
      if (info.kidsBox) {
        for (const c of info.kidsBox.children) {
          if (rec(c)) childHit = true;
        }
      }
      el.classList.toggle("ptt-hit", !!selfHit);
      el.classList.toggle("ptt-openpath", !!(selfHit || childHit) && !!q);
      if (info.kidsBox && info.tog && !info.tog.disabled) {
        if (q && (selfHit || childHit)) {
          info.kidsBox.hidden = false;
          info.tog.textContent = "−";
        } else {
          info.kidsBox.hidden = true;
          info.tog.textContent = "+";
        }
      }
      if (selfHit) hits++;
      return selfHit || childHit;
    }
    const start = rootEl.querySelector(".ptt-node");
    if (start) rec(start);
    return hits;
  }

  function countLeaves(n) {
    if (!n.kids.length) return n.text ? 1 : 0;
    return n.kids.reduce((a, k) => a + countLeaves(k), 0) + (n.text ? 1 : 0);
  }

  let pickSeq = 0;

  function renumberPicks() {
    const box = document.getElementById("ptt-picks");
    if (!box) return;
    [...box.querySelectorAll(".ptt-pick")].forEach((row, i) => {
      const n = row.querySelector(".ptt-n");
      if (n) n.textContent = String(i + 1).padStart(4, "0");
    });
    pickSeq = box.querySelectorAll(".ptt-pick").length;
  }

  function addPick(node) {
    const box = document.getElementById("ptt-picks");
    if (!box || !node) return;
    const path = node.path || node.tag || "";
    const row = document.createElement("div");
    row.className = "ptt-pick on";
    const num = document.createElement("span");
    num.className = "ptt-n";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = path;
    inp.spellcheck = false;
    row.appendChild(num);
    row.appendChild(inp);
    box.querySelectorAll(".ptt-pick").forEach((r) => r.classList.remove("on"));
    box.appendChild(row);
    renumberPicks();
    inp.addEventListener("focus", () => {
      box.querySelectorAll(".ptt-pick").forEach((r) => r.classList.remove("on"));
      row.classList.add("on");
    });
    inp.focus();
    inp.select();
    box.scrollTop = box.scrollHeight;
  }

  function build() {
    const box = document.getElementById("ptt-tree");
    const meta = document.getElementById("ptt-meta");
    const qel = document.getElementById("ptt-q");
    if (!box || !meta) return;
    const sels = parseScope(document.getElementById("ptt-scope") && document.getElementById("ptt-scope").value);
    const largest = sels.length ? pickLargest(sels) : "";
    const lab = document.getElementById("ptt-largest");
    if (lab) lab.textContent = largest ? ("largest: " + largest) : "largest: —";
    const tree = walk(document.documentElement, sels, false, "", largest) || { tag: "html", text: "", kids: [], path: "html" };
    box.textContent = "";
    const canvas = document.createElement("div");
    canvas.id = "ptt-canvas";
    canvas.appendChild(renderNode(tree));
    box.appendChild(canvas);
    meta.textContent = countLeaves(tree) + " text pieces · all folded · type to expand hits";
    applySearch(box, qel ? qel.value : "");
  }

  function host() {
    return document.body || document.documentElement;
  }

  function paintFab(fab) {
    fab.style.cssText = [
      "position:fixed", "left:16px", "bottom:16px", "z-index:2147483647",
      "width:52px", "height:52px", "border-radius:26px",
      "border:2px solid #fff", "background:#111", "color:#fff",
      "font:700 20px/52px sans-serif", "text-align:center", "cursor:pointer",
      "opacity:1", "display:block", "visibility:visible", "pointer-events:auto"
    ].join(";");
  }

  function mount() {
    try { ensureStyle(); } catch (_) {}
    const parent = host();
    if (!parent) return false;

    let fab = document.getElementById("ptt-fab");
    if (!fab) {
      fab = document.createElement("button");
      fab.id = "ptt-fab";
      fab.type = "button";
      fab.title = "Page text tree";
      fab.textContent = "T";
      fab.addEventListener("click", () => {
        const p = document.getElementById("ptt-panel");
        if (!p) return;
        p.hidden = !p.hidden;
        if (!p.hidden) {
          build();
          const q = document.getElementById("ptt-q");
          if (q) q.focus();
        }
      });
    }
    if (fab.parentNode !== parent) parent.appendChild(fab);
    paintFab(fab);

    let panel = document.getElementById("ptt-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ptt-panel";
      panel.hidden = true;

      const head = document.createElement("div");
      head.id = "ptt-head";
      const q = document.createElement("input");
      q.id = "ptt-q";
      q.type = "search";
      q.placeholder = "Search text nodes…";
      const rebuild = document.createElement("button");
      rebuild.id = "ptt-rebuild";
      rebuild.type = "button";
      rebuild.textContent = "Rebuild";
      const close = document.createElement("button");
      close.id = "ptt-close";
      close.type = "button";
      close.textContent = "×";
      head.appendChild(q);
      head.appendChild(rebuild);
      head.appendChild(close);

      const scopeRow = document.createElement("div");
      scopeRow.id = "ptt-scope-row";
      const scope = document.createElement("input");
      scope.id = "ptt-scope";
      scope.type = "text";
      scope.placeholder = "Scope OR: ytd-comment-thread-renderer, #content-text, p, article";
      const largestLab = document.createElement("span");
      largestLab.id = "ptt-largest";
      largestLab.textContent = "largest: —";
      scopeRow.appendChild(scope);
      scopeRow.appendChild(largestLab);

      const meta = document.createElement("div");
      meta.id = "ptt-meta";
      const tree = document.createElement("div");
      tree.id = "ptt-tree";
      const picks = document.createElement("div");
      picks.id = "ptt-picks";

      panel.appendChild(head);
      panel.appendChild(scopeRow);
      panel.appendChild(meta);
      panel.appendChild(tree);
      panel.appendChild(picks);

      close.addEventListener("click", () => { panel.hidden = true; });
      rebuild.addEventListener("click", build);
      let st = 0;
      scope.addEventListener("input", () => {
        clearTimeout(st);
        st = setTimeout(build, 200);
      });
      let t = 0;
      q.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const box = document.getElementById("ptt-tree");
          const n = applySearch(box, q.value);
          meta.textContent = norm(q.value)
            ? n + " hits · path unfolded to matches"
            : "all folded · type to expand hits";
          const first = box && box.querySelector(".ptt-hit");
          if (first) first.scrollIntoView({ block: "center" });
        }, 80);
      });
    }
    if (panel.parentNode !== parent) parent.appendChild(panel);
    return true;
  }

  function boot() {
    mount();
  }

  boot();
  document.addEventListener("DOMContentLoaded", boot);
  window.addEventListener("load", boot);
  document.addEventListener("yt-navigate-finish", boot);
  document.addEventListener("yt-page-data-updated", boot);
  setInterval(() => {
    if (!document.getElementById("ptt-fab") || !document.getElementById("ptt-panel")) mount();
  }, 1500);
})();
