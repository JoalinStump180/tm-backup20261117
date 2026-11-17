// ==UserScript==
// @name         Hash tab tester (Foldable & Persistent)
// @namespace    hash-tab-tester
// @version      0.3.5
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
(() => {
  "use strict";
  const DB_NAME = "hashTabTester";
  const STORE = "hashTexts";
  const POLICY_KEY = "hashTabPolicy";
  const FOLDED_KEY = "hashTabFoldedState";

  const DEFAULT_POLICY = [
    "youtube.com:",
    "  ytd-comment-view-model;#author-text:1,3-4;yt-attributed-string#content-text:1-2,5-6",
    "  ytd-backstage-post-renderer;#author-text:1;yt-formatted-string#content-text:1,3-4",
    "end",
    "othersite.com:",
    "  .comment;ti:\"User Said:\";ti:\"Chatgpt Said:\"",
    "end"
  ].join("\n");

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "hashKey" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function getRow(db, key) {
    return new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  function putRow(db, row) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function cheapHash(text) {
    let h = 5381;
    const str = String(text || "");
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }
  function siteName() {
    return location.hostname.replace(/^www\./, "");
  }
  function parseSlots(spec) {
    const slots = new Set();
    for (const part of String(spec || "").split(",")) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) slots.add(n);
    }
    return slots;
  }
  function parseField(raw) {
    const s = String(raw || "").trim();
    const ti = s.match(/^ti:\s*["']([\s\S]*?)["']$/i);
    if (ti) return { kind: "ti", text: ti[1], slots: new Set([1]) };
    const m = s.match(/^(.*):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/);
    if (m) return { kind: "sel", sel: m[1].trim(), slots: parseSlots(m[2]) };
    return { kind: "sel", sel: s, slots: new Set([1]) };
  }
  function parsePolicies(text) {
    const blocks = [];
    let cur = null;
    for (const raw of String(text || "").split(/\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^end$/i.test(line)) { if (cur) blocks.push(cur); cur = null; continue; }
      if (line.endsWith(":") && !line.includes(";")) {
        cur = { host: line.slice(0, -1).trim().replace(/^www\./, ""), lines: [] };
        continue;
      }
      if (!cur) continue;
      const parts = line.split(";").map((x) => x.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      cur.lines.push({ scope: parts[0], start: parseField(parts[1]), collect: parseField(parts[2]) });
    }
    if (cur) blocks.push(cur);
    return blocks;
  }
  function policiesForHere(text) {
    const host = siteName();
    return parsePolicies(text).filter((b) => host === b.host || host.endsWith("." + b.host));
  }
  function nodeBlob(el) {
    if (!el) return "";
    const attrs = [];
    for (const a of el.attributes || []) attrs.push(a.name + "=" + a.value);
    return (el.innerText || "") + "\n" + attrs.join("\n");
  }
  function matches(el, field) {
    if (!el || !field) return false;
    if (field.kind === "ti") return nodeBlob(el).includes(field.text);
    try { return el.matches(field.sel); } catch { return false; }
  }
  function allIn(scope, field) {
    if (field.kind === "ti") {
      const out = [];
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
      let n = walker.currentNode;
      while (n) {
        if (matches(n, field)) out.push(n);
        n = walker.nextNode();
      }
      return out;
    }
    try { return [...scope.querySelectorAll(field.sel)]; } catch { return []; }
  }
  function pickSlots(list, slots, seen) {
    const fresh = list.filter((el) => !seen.has(el));
    const picked = [];
    fresh.forEach((el, i) => {
      const slot = i + 1;
      if (!slots.has(slot)) return;
      seen.add(el);
      picked.push({ el, slot });
    });
    return picked;
  }
   function collect(policyText) {
    const site = siteName();
    const out = [];
    const seenKey = new Set();
    function push(author, slot, text) {
      const t = (text || "").trim();
      if (!t) return;                       // skip empty / whitespace
      const hashKey = site + "|" + author + "|" + slot + "|" + cheapHash(t);
      if (seenKey.has(hashKey)) return;
      seenKey.add(hashKey);
      out.push({ hashKey, site, author, slot, text: t, sourceUrl: location.href });
    }
    for (const block of policiesForHere(policyText)) {
      for (const rule of block.lines) {
        const seen = new Set();
        let scopes = [];
        try { scopes = document.querySelectorAll(rule.scope); } catch { continue; }
        for (const A of scopes) {
          // ---- new: identical start/collect selector → self-text ----
          if (rule.start.kind === "sel" && rule.collect.kind === "sel" &&
              rule.start.sel === rule.collect.sel) {
            const hits = pickSlots(allIn(A, rule.start), rule.start.slots, seen);
            hits.forEach((hit) => {
              const author = ((hit.el.innerText || "").trim().split("\n")[0] || "item");
              push(author, hit.slot, hit.el.innerText || "");
            });
            continue;
          }
          // ---- original paths unchanged ----
          if (rule.start.kind === "ti" && rule.collect.kind === "ti") {
            const starts = pickSlots(allIn(A, rule.start), rule.start.slots, seen);
            for (const st of starts) {
              push("ti", st.slot, (st.el.innerText || "").trim());
              const walker = document.createTreeWalker(A, NodeFilter.SHOW_ELEMENT);
              walker.currentNode = st.el;
              let n = walker.nextNode();
              while (n) {
                if (!seen.has(n) && matches(n, rule.collect)) {
                  seen.add(n);
                  push("ti", st.slot, (n.innerText || "").trim());
                  break;
                }
                n = walker.nextNode();
              }
            }
            continue;
          }
          const starts = pickSlots(allIn(A, rule.start), rule.start.slots, seen);
          for (const st of starts) {
            const href = st.el.getAttribute("href") || "";
            const handle = href.match(/\/@([\w.-]+)/);
            const author = handle ? "@" + handle[1] : ((st.el.innerText || "").trim().split("\n")[0] || "item");
            //const hits = pickSlots(allIn(A, rule.collect), rule.collect.slots, seen);
            const parent = st.el.parentNode;
            const hits = parent ? pickSlots(allIn(parent, rule.collect), rule.collect.slots, seen) : [];
            hits.forEach((hit) => push(author, hit.slot, (hit.el.innerText || "").trim()));
          }
        }
      }
    }
    return out;
  }

  const isFolded = GM_getValue(FOLDED_KEY, false) === true;

  const box = document.createElement("div");
  box.style.cssText = isFolded
    ? "position:fixed;top:72px;right:12px;z-index:2147483646;background:rgba(12,16,24,.72);color:#f2f2f2;font:12px/1.45 Consolas,monospace;padding:4px 6px;border:1px solid rgba(255,255,255,.25);border-radius:8px;"
    : "position:fixed;top:72px;right:12px;z-index:2147483646;width:560px;max-height:80vh;overflow:auto;background:rgba(12,16,24,.72);color:#f2f2f2;font:12px/1.45 Consolas,monospace;padding:8px 10px;border:1px solid rgba(255,255,255,.25);border-radius:8px;";
  box.dataset.folded = isFolded ? "true" : "false";

  const bar = document.createElement("div");
  bar.style.cssText = isFolded
    ? "cursor:move;margin-bottom:0;font-weight:700;display:flex;justify-content:center;align-items:center;"
    : "cursor:move;margin-bottom:6px;font-weight:700;display:flex;justify-content:space-between;align-items:center;";

  const barTitle = document.createElement("span");
  barTitle.textContent = "hash policy (drag)";
  barTitle.style.display = isFolded ? "none" : "";

  const closeButton = document.createElement("button");
  closeButton.textContent = isFolded ? "+" : "−";
  closeButton.title = "Fold / unfold";
  closeButton.style.cssText = "color:white;background:transparent;border:none;cursor:pointer;font-size:18px;line-height:18px;padding:0 4px;";

  bar.appendChild(barTitle);
  bar.appendChild(closeButton);

  const area = document.createElement("textarea");
  area.value = GM_getValue(POLICY_KEY, DEFAULT_POLICY);
  area.style.cssText = "width:100%;height:140px;box-sizing:border-box;background:#111;color:#fff;border:1px solid #666;padding:4px 6px;font:inherit;";
  area.style.display = isFolded ? "none" : "";
  area.addEventListener("change", () => GM_setValue(POLICY_KEY, area.value));

  const colors = document.createElement("div");
  colors.style.cssText = "display:flex;gap:10px;align-items:center;margin:6px 0;";
  colors.style.display = isFolded ? "none" : "";

  function colorPick(key, label, fallback) {
    const wrap = document.createElement("label");
    wrap.style.cssText = "display:flex;align-items:center;gap:4px;";
    wrap.appendChild(document.createTextNode(label));
    const input = document.createElement("input");
    input.type = "color";
    input.value = GM_getValue(key, fallback);
    input.addEventListener("change", () => GM_setValue(key, input.value));
    wrap.appendChild(input);
    return input;
  }
  const newColor = colorPick("hashTabNewColor", "NEW", "#00ff00");
  const alreadyColor = colorPick("hashTabAlreadyColor", "ALREADY", "#ff0000");
  const keyColor = colorPick("hashTabKeyColor", "key", "#ffffff");
  colors.appendChild(newColor.parentElement);
  colors.appendChild(alreadyColor.parentElement);
  colors.appendChild(keyColor.parentElement);

  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply / Save";
  applyBtn.style.cssText = "margin:4px 0 6px; padding:2px 10px; cursor:pointer; font:inherit;";
  applyBtn.style.display = isFolded ? "none" : "";
  applyBtn.addEventListener("click", () => {
    GM_setValue(POLICY_KEY, area.value);
    shown.clear();
    tick().catch(err => logLine("ALREADY", "error", String(err)));
    logLine("NEW", "policy", "saved & applied");
  });

  const pre = document.createElement("pre");
  pre.style.cssText = "margin:6px 0 0;white-space:pre-wrap;min-height:160px;";
  pre.style.display = isFolded ? "none" : "";

  const logWrap = document.createElement("label");
  logWrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:0 0 6px;";
  logWrap.style.display = isFolded ? "none" : "";

  const logBox = document.createElement("input");
  logBox.type = "checkbox";
  logBox.checked = GM_getValue("hashTabLog", true);
  logBox.addEventListener("change", () => GM_setValue("hashTabLog", logBox.checked));
  logWrap.appendChild(logBox);
  logWrap.appendChild(document.createTextNode("log to IndexedDB"));

  box.appendChild(bar);
  box.appendChild(area);
  box.appendChild(colors);
  box.appendChild(applyBtn);
  box.appendChild(logWrap);
  box.appendChild(pre);
  document.documentElement.appendChild(box);

  let anchorRight = null;
  let anchorTop = null;

  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const folded = box.dataset.folded !== "true";
    GM_setValue(FOLDED_KEY, folded);

    if (anchorRight === null) {
      const r = closeButton.getBoundingClientRect();
      anchorRight = r.right;
      anchorTop = r.top;
    }

    area.style.display = folded ? "none" : "";
    colors.style.display = folded ? "none" : "";
    applyBtn.style.display = folded ? "none" : "";
    logWrap.style.display = folded ? "none" : "";
    pre.style.display = folded ? "none" : "";
    barTitle.style.display = folded ? "none" : "";
    box.dataset.folded = folded ? "true" : "false";
    closeButton.textContent = folded ? "+" : "−";

    if (folded) {
      bar.style.marginBottom = "0";
      bar.style.justifyContent = "center";
      box.style.width = "auto";
      box.style.minWidth = "0";
      box.style.padding = "4px 6px";
    } else {
      bar.style.marginBottom = "6px";
      bar.style.justifyContent = "space-between";
      box.style.width = "560px";
      box.style.minWidth = "";
      box.style.padding = "8px 10px";
    }

    requestAnimationFrame(() => {
      const r = closeButton.getBoundingClientRect();
      box.style.left = box.getBoundingClientRect().left + anchorRight - r.right + "px";
      box.style.top = box.getBoundingClientRect().top + anchorTop - r.top + "px";
      box.style.right = "auto";
    });
  });

  let drag = false, dx = 0, dy = 0;
  bar.addEventListener("mousedown", (e) => {
    if (e.target === closeButton) return;
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

  const shown = new Set();
  function logLine(kind, key, rest) {
    const line = document.createElement("div");
    const word = document.createElement("span");
    word.textContent = kind;
    word.style.color = kind === "NEW" ? newColor.value : alreadyColor.value;
    word.style.fontWeight = "700";
    const keySpan = document.createElement("span");
    keySpan.textContent = " " + key + " ";
    keySpan.style.color = keyColor.value;
    line.appendChild(word);
    line.appendChild(keySpan);
    line.appendChild(document.createTextNode(rest));
    pre.insertBefore(line, pre.firstChild);
    while (pre.childElementCount > 80) pre.removeChild(pre.lastChild);
  }

  async function tick() {
    const batch = collect(area.value);
    if (!batch.length) return;
    const db = await openDb();
    for (const row of batch) {
      if (shown.has(row.hashKey)) continue;
      shown.add(row.hashKey);
      const existing = await getRow(db, row.hashKey);
      const two = row.text.split(/\n/).slice(0, 2).join(" / ");
      if (existing) logLine("ALREADY", row.hashKey, new Date(existing.createdAt).toLocaleString() + " " + two);
      else if (logBox.checked) {
        await putRow(db, { ...row, createdAt: Date.now() });
        logLine("NEW", row.hashKey, two);
      } else {
        logLine("NEW", row.hashKey, "(not logged) " + two);
      }
    }
  }
  setInterval(() => { tick().catch((err) => logLine("ALREADY", "error", String(err))); }, 1000);
  logLine("NEW", siteName(), "hash tab tester ready");
})();