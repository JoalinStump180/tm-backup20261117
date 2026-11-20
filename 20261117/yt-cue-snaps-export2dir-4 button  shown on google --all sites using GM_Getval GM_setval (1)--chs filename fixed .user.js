// ==UserScript==
// @name         YT cue snapshots add export
// @namespace    local.yt-cue-snaps
// @version      0.1.0
// @description  Detect YouTube ad/play stage and save up to 3 viewport snapshots per video.
// @match        https://*/*
// @match        https://m.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";



        var currentURL='currurl';
var lastURL='lasturl';
            var currentTitle='currurl';
var lastTitle='lasturl';
  const DB_NAME = "ytCueSnaps";
  const DB_VERSION = 1;
  const STORE = "snaps";
  const SLOT1_AFTER = 10;
  const SLOT2_FROM = 60;
  const SLOT2_TO = 150;
  const SLOT3_FROM = 150;

  function styleBtn(b) {
    Object.assign(b.style, {
      display: "inline-block",
      background: "#e1e1e1",
      color: "#222",
      border: "1px solid #888",
      borderRadius: "4px",
      padding: "2px 8px",
      margin: "0 4px 4px 0",
      height: "24px",
      font: "12px/20px Segoe UI, sans-serif",
      cursor: "pointer",
      visibility: "visible",
      opacity: "1",
      boxSizing: "border-box"
    });
    return b;
  }


  const SNAPS_KEY = "ytCueSnaps";

  function snapKey(videoId, slot) {
    return videoId + "|" + slot;
  }

  function loadSnaps() {
    try {
      const rows = GM_getValue(SNAPS_KEY, []);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function saveSnaps(rows) {
    GM_setValue(SNAPS_KEY, rows);
  }

  async function getSnap(videoId, slot) {
    const key = snapKey(videoId, slot);
    return loadSnaps().find((row) => row.key === key) || null;
  }

  async function putSnap(row) {
    const rows = loadSnaps().filter((item) => item.key !== row.key);
    rows.push(row);
    saveSnaps(rows);
  }

  async function allSnaps() {
    return loadSnaps();
  }

  async function snapsFor(videoId) {
    const rows = await allSnaps();
    return rows.filter((r) => r.videoId === videoId).sort((a, b) => a.slot - b.slot);
  }

  async function deleteWhere(pred) {
    saveSnaps(loadSnaps().filter((row) => !pred(row)));
  }

  function videoIdFromLocation() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") return parts[1] || "";
    } catch {}
    return "";
  }

  function player() {
    return document.querySelector("#movie_player, .html5-video-player");
  }

  function videoEl() {
    const root = player() || document;
    return root.querySelector("video.html5-main-video, video");
  }

  function isAd() {
    const p = player();
    if (!p) return false;
    if (p.classList.contains("ad-showing")) return true;
    if (p.querySelector(".ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-skip-button, .ytp-ad-skip-button-modern")) return true;
    const v = videoEl();
    if (v && v.closest && v.closest(".ad-showing")) return true;
    return false;
  }

  function stage() {
    const v = videoEl();
    if (!v) return "none";
    if (isAd()) return "ads";
    return "play";
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  function slotFor(cue, duration) {
    if (!Number.isFinite(cue) || !Number.isFinite(duration) || duration <= 0) return 0;
    if (duration < 60) return cue > SLOT1_AFTER ? 1 : 0;
    if (cue >= SLOT3_FROM) return 3;
    if (cue >= SLOT2_FROM && cue < SLOT2_TO) return 2;
    if (cue > SLOT1_AFTER) return 1;
    return 0;
  }

  function captureFrame(video) {
    const w = video.videoWidth || video.clientWidth;
    const h = video.videoHeight || video.clientHeight;
    if (!w || !h) throw new Error("video has no size");
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  let panel, titleEl, bodyEl, listEl, minBtn, captureBox;
  const CAPTURE_KEY = "yt-cue-snaps-capture-on";
  let captureOn = localStorage.getItem(CAPTURE_KEY) !== "0";
  const MAX_LEN_KEY = "yt-cue-snaps-folder-max-len";
  function clampFolderMaxLen(raw) {
    const n = Number.parseInt(String(raw ?? "").trim(), 10);
    if (!Number.isInteger(n) || n < 1) return 80;
    return Math.min(n, 200);
  }
  let folderMaxLen = clampFolderMaxLen(localStorage.getItem(MAX_LEN_KEY));
  let searchBox, rangeBox, maxLenBox, hitCountEl, pageLabel, goBox;
  let expanded = false;
  let busy = false;
  let pageIndex = 0;
  const PAGE = 10;
  let collected = [];

  function ensureUi() {
    if (panel && panel.isConnected) return;
    panel = document.createElement("div");
    panel.id = "yt-cue-snap-panel";
    Object.assign(panel.style, {
      position: "fixed",
      zIndex: "2147483647",
      left: "8px",
      top: "8px",
      width: "760px",
      background: "rgba(0,0,0,.82)",
      color: "#fff",
      font: "12px/1.4 Consolas, monospace",
      borderRadius: "6px",
      padding: "0"
    });

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "4px 6px",
      userSelect: "none",
      background: "rgba(255,255,255,.12)"
    });
    titleEl = document.createElement("span");
    titleEl.textContent = "snaps 0";
    minBtn = styleBtn(document.createElement("button"));
    minBtn.type = "button";
    minBtn.textContent = "+";
    Object.assign(minBtn.style, {
      color: "#fff",
      background: "#c0392b",
      border: "1px solid rgba(255,255,255,.4)",
      borderRadius: "3px",
      cursor: "pointer",
      width: "22px",
      height: "18px",
      lineHeight: "14px"
    });
    const capLabel = document.createElement("label");
    capLabel.style.display = "flex";
    capLabel.style.alignItems = "center";
    capLabel.style.gap = "4px";
    capLabel.style.marginLeft = "8px";
    captureBox = document.createElement("input");
    captureBox.type = "checkbox";
    captureBox.checked = captureOn;
    captureBox.title = "Start or pause capture. Saved across YouTube pages.";
    captureBox.addEventListener("change", () => {
      captureOn = captureBox.checked;
      localStorage.setItem(CAPTURE_KEY, captureOn ? "1" : "0");
    });
    capLabel.append(captureBox, document.createTextNode("capture"));
    bar.append(titleEl, capLabel, minBtn);

    const fixed = document.createElement("div");
    fixed.style.background = "rgba(0,0,0,.82)";
    fixed.style.padding = "6px";

    bodyEl = document.createElement("div");
    bodyEl.style.display = "none";
    bodyEl.style.maxHeight = "70vh";
    bodyEl.style.overflow = "auto";
    bodyEl.style.background = "#fff";

    const actions = document.createElement("div");
    actions.style.marginBottom = "8px";
    for (const [label, from] of [["clear 1 and up", 1], ["clear 2 and up", 2], ["clear all", 1]]) {
      const b = styleBtn(document.createElement("button"));
      b.type = "button";
      b.textContent = label;
      b.style.marginRight = "4px";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        clearSlots(from);
      });
      actions.appendChild(b);
    }
    const viewAll = styleBtn(document.createElement("button"));
    viewAll.type = "button";
    viewAll.textContent = "view all";
    viewAll.addEventListener("click", (e) => {
      e.stopPropagation();
      expanded = true;
      bodyEl.style.display = "";
      minBtn.textContent = "–";
      openPanel();
    });
    actions.appendChild(viewAll);
    const all = styleBtn(document.createElement("button"));
    all.type = "button";
    all.textContent = "clear all videos";
    all.addEventListener("click", (e) => {
      e.stopPropagation();
      clearSlots(1, "*");
    });
    actions.appendChild(all);
    const export2 = styleBtn(document.createElement("button"));
    export2.type = "button";
    export2.textContent = "export2_dir";
    export2.title = "Zip thumbs into folders. Asks for YYYYMMDD-YYYYMMDD.";
    export2.addEventListener("click", (e) => {
      e.stopPropagation();
      export2Dir().catch((err) => alert("export2_dir failed: " + err));
    });
    actions.appendChild(export2);

    const searchRow = document.createElement("div");
    searchRow.style.display = "flex";
    searchRow.style.alignItems = "center";
    searchRow.style.gap = "6px";
    searchRow.style.margin = "8px 0";
    searchRow.style.flexWrap = "wrap";
    searchBox = document.createElement("input");
    searchBox.type = "search";
    searchBox.placeholder = "Search title, url, length";
    searchBox.style.flex = "1";
    searchBox.style.minWidth = "140px";
    searchBox.addEventListener("input", () => {
      pageIndex = 0;
      openPanel();
    });
    rangeBox = document.createElement("input");
    rangeBox.type = "text";
    rangeBox.placeholder = "202608 202610";
    rangeBox.title = "YYYYMM YYYYMM, inclusive";
    rangeBox.style.width = "130px";
    rangeBox.addEventListener("input", () => {
      pageIndex = 0;
      openPanel();
    });
    maxLenBox = document.createElement("input");
    maxLenBox.type = "text";
    maxLenBox.value = String(folderMaxLen);
    maxLenBox.placeholder = "80";
    maxLenBox.title = "Max folder title length in ZIP (default 80, 1-200)";
    maxLenBox.style.width = "46px";
    maxLenBox.addEventListener("change", () => {
      folderMaxLen = clampFolderMaxLen(maxLenBox.value);
      maxLenBox.value = String(folderMaxLen);
      localStorage.setItem(MAX_LEN_KEY, String(folderMaxLen));
    });
    hitCountEl = document.createElement("span");
    hitCountEl.textContent = "hits 0";
    hitCountEl.style.minWidth = "64px";
    const prevPage = styleBtn(document.createElement("button"));
    prevPage.type = "button";
    prevPage.textContent = "prev";
    prevPage.addEventListener("click", (e) => { e.stopPropagation(); stepPage(-1); });
    const nextPage = styleBtn(document.createElement("button"));
    nextPage.type = "button";
    nextPage.textContent = "next";
    nextPage.addEventListener("click", (e) => { e.stopPropagation(); stepPage(1); });
    pageLabel = document.createElement("span");
    pageLabel.textContent = "1 / 1";
    goBox = document.createElement("input");
    goBox.type = "text";
    goBox.placeholder = "89";
    goBox.title = "Item number. 89 goes to page 9.";
    goBox.style.width = "52px";
    const goBtn = styleBtn(document.createElement("button"));
    goBtn.type = "button";
    goBtn.textContent = "go";
    goBtn.addEventListener("click", (e) => { e.stopPropagation(); goToItem(); });
    searchRow.append(searchBox, rangeBox, maxLenBox, hitCountEl, prevPage, nextPage, pageLabel, goBox, goBtn);

    listEl = document.createElement("div");
    fixed.append(actions, searchRow);
    bodyEl.append(listEl);
    panel.append(bar, fixed, bodyEl);
    document.documentElement.appendChild(panel);
    panel.style.display = "none";

    minBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      expanded = !expanded;
      bodyEl.style.display = expanded ? "" : "none";
      minBtn.textContent = expanded ? "–" : "+";
      if (expanded) openPanel();
    });
  }

  async function clearSlots(fromSlot, videoId) {
    const id = videoId || videoIdFromLocation();
    if (!id && videoId !== "*") return;
    const who = videoId === "*" ? "all videos" : id;
    const what = fromSlot <= 1 ? "all slots" : "slot " + fromSlot + " and up";
    if (!confirm("Clear " + what + " for " + who + "?")) return;
    await deleteWhere((row) => {
      if (videoId === "*") return row.slot >= fromSlot;
      return row.videoId === id && row.slot >= fromSlot;
    });
    await paintCount();
    if (expanded) await openPanel();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      if (c === "&") return "&" + "amp;";
      if (c === "<") return "&" + "lt;";
      if (c === ">") return "&" + "gt;";
      if (c === '"') return "&" + "quot;";
      if (c === "'") return "&" + "#39;";
      return c;
    });
  }

  function videoUrl(id) {
    return "https://www.youtube.com/watch?v=" + id;
  }
  function stampParts(ms) {
    const d = new Date(ms || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return {
      date: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()),
      time: p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
    };
  }
  function cell(text, width) {
    const td = document.createElement("td");
    td.textContent = text || "";
    td.style.padding = "4px 8px";
    td.style.borderBottom = "1px solid #eee";
    td.style.whiteSpace = "nowrap";
    td.style.overflow = "hidden";
    td.style.textOverflow = "ellipsis";
    td.style.color = "#222";
    if (width) td.style.width = width;
    return td;
  }
  function addBtn(parent, label, run) {
    const b = styleBtn(document.createElement("button"));
    b.type = "button";
    b.textContent = label;
    b.style.marginRight = "4px";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      run();
    });
    parent.appendChild(b);
    return b;
  }
  function monthRange(raw) {
    const m = String(raw || "").trim().match(/^(\d{6})\s+(\d{6})$/);
    if (!m) return null;
    const start = new Date(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, 1).getTime();
    const endMs = new Date(+m[2].slice(0, 4), +m[2].slice(4, 6), 0, 23, 59, 59, 999).getTime();
    return start <= endMs ? { start, end: endMs } : null;
  }
  function newestAt(list) {
    return Math.max(...list.map((row) => row.capturedAt || 0));
  }
  async function collectHits(keyword) {
    const rows = await allSnaps();
    const byVideo = new Map();
    for (const row of rows) {
      const bag = byVideo.get(row.videoId) || [];
      bag.push(row);
      byVideo.set(row.videoId, bag);
    }
    const q = String(keyword || "").trim().toLowerCase();
    const range = monthRange(rangeBox && rangeBox.value);
    const hits = [];
for (const [id, list] of byVideo.entries()) {
      const folder = dirName(list[0].title, id, folderMaxLen);
      for (const row of list) {
        if (!row.image) continue;
        const shotTime = safeCueTag(row.cue);
        const rawTitle = row.title || list[0].title || id;
        const title40 = safePart(rawTitle).slice(0, 40);
        const suffix = title40 ? `_${title40}` : "";
        const fileName = `slot${row.slot}_[${safePart(id)}][${safePart(shotTime)}]${suffix}.jpg`;
        files.push({
          name: folder + "/" + fileName,
          bytes: dataUrlBytes(row.image),
          mtime: row.capturedAt || Date.now()
        });
      }
    }
    hits.sort((a, b) => b.when - a.when);
    return hits;
  }
  function pageCount() {
    return Math.max(1, Math.ceil(collected.length / PAGE));
  }
  function paintPageLabel() {
    if (hitCountEl) hitCountEl.textContent = "hits " + collected.length;
    if (pageLabel) pageLabel.textContent = (pageIndex + 1) + " / " + pageCount();
  }
  function stepPage(dir) {
    const next = pageIndex + dir;
    if (next < 0 || next >= pageCount()) return;
    pageIndex = next;
    renderPage();
  }
  function goToItem() {
    const n = Number.parseInt(goBox && goBox.value, 10);
    if (!Number.isInteger(n) || n < 1 || !collected.length) return;
    const item = Math.min(n, collected.length);
    pageIndex = Math.ceil(item / PAGE) - 1;
    renderPage();
  }
  function renderPage() {
    if (!listEl) return;
    paintPageLabel();
    listEl.replaceChildren();
    const slice = collected.slice(pageIndex * PAGE, pageIndex * PAGE + PAGE);
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.tableLayout = "fixed";
    table.style.background = "#fff";
    table.style.color = "#222";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const [name, width] of [["Date", "90px"], ["Time", "70px"], ["Title", "180px"], ["URL", ""], ["Len", "60px"]]) {
      const th = document.createElement("th");
      th.textContent = name;
      th.style.textAlign = "left";
      th.style.background = "#f5f5f5";
      th.style.borderBottom = "1px solid #d0d0d0";
      th.style.padding = "5px 8px";
      th.style.color = "#222";
      if (width) th.style.width = width;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = document.createElement("tbody");
    if (!slice.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = collected.length ? "No items on this page." : "No hits.";
      td.style.padding = "12px";
      td.style.color = "#777";
      tr.appendChild(td);
      tb.appendChild(tr);
    }
    slice.forEach((hit, i) => {
      const n = pageIndex * PAGE + i + 1;
      const { id, list } = hit;
      const first = list[0];
      const stamp = stampParts(Math.min(...list.map((x) => x.capturedAt || Date.now())));
   const nameTd = cell(n + ". " + (first.title || id), "180px");
      nameTd.title = first.title || id;
      const urlTd = cell(videoUrl(id));
      urlTd.title = videoUrl(id);
      const tr = document.createElement("tr");
      tr.append(
        cell(stamp.date, "90px"),
        cell(stamp.time, "70px"),
        nameTd,
        urlTd,
        cell(fmtTime(first.duration), "60px")
      );
      tb.appendChild(tr);
      const detail = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.style.padding = "6px 8px 10px 22px";
      td.style.background = "#fafafa";
      td.style.borderBottom = "1px solid #eee";
      const clears = document.createElement("div");
      clears.style.marginBottom = "6px";
      addBtn(clears, "clear 1 and up", () => clearSlots(1, id));
      addBtn(clears, "clear 2 and up", () => clearSlots(2, id));
      addBtn(clears, "clear all", () => clearSlots(1, id));
      td.appendChild(clears);
      const thumbRow = document.createElement("div");
      thumbRow.style.display = "flex";
      thumbRow.style.gap = "8px";
      thumbRow.style.alignItems = "flex-start";
      for (const slot of [1, 2, 3]) {
        const row = list.find((x) => x.slot === slot);
        const shot = document.createElement("div");
        shot.style.width = "280px";
        shot.style.flex = "0 0 280px";
        if (!row) {
          shot.textContent = "slot " + slot + ": none";
          shot.style.color = "#777";
        } else {
          const cap = document.createElement("div");
          cap.style.color = "#555";
          cap.style.fontFamily = "Consolas, monospace";
          cap.textContent = "slot " + slot + "  " + fmtTime(row.cue);
          const img = document.createElement("img");
          img.src = row.image;
          img.alt = "slot " + slot;
          img.style.width = "280px";
          img.style.display = "block";
          img.style.marginTop = "4px";
          img.style.border = "1px solid #ccc";
          shot.append(cap, img);
        }
        thumbRow.appendChild(shot);
      }
      td.appendChild(thumbRow);
      detail.appendChild(td);
      tb.appendChild(detail);
    });
    table.appendChild(tb);
    listEl.appendChild(table);
  }
  async function openPanel() {
    const keyword = searchBox && searchBox.value || "";
    collected = await collectHits(keyword);
    if (pageIndex >= pageCount()) pageIndex = 0;
    renderPage();
  }

  async function paintCount() {
    const id = videoIdFromLocation();
    const rows = id ? await snapsFor(id) : [];
    const v = videoEl();
    const st = stage();
    const cue = v ? v.currentTime : 0;
    const dur = v ? v.duration : 0;
    const pct = dur ? Math.round((cue / dur) * 1000) / 10 : 0;
    if (titleEl) titleEl.textContent = "snaps " + rows.length + " · " + st + " " + pct + "%";
  }

  function captureEnabled() {
    captureOn = localStorage.getItem(CAPTURE_KEY) !== "0";
    if (captureBox && captureBox.checked !== captureOn) captureBox.checked = captureOn;
    return captureOn;
  }
  async function maybeCapture() {



      currentURL = window.location.href;
      currentTitle = document.title;
       if (currentURL !== lastURL && currentTitle === lastTitle) return;
      lastTitle=currentTitle;
      lastURL=currentURL;

    if (!captureEnabled()) return;
    if (busy) return;
    const id = videoIdFromLocation();
    const v = videoEl();
    if (!id || !v || stage() !== "play") return;
    if (v.readyState < 2 || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const slot = slotFor(v.currentTime, v.duration);
    if (!slot) return;
    if (await getSnap(id, slot)) return;
    busy = true;
    try {
      const image = captureFrame(v);
      await putSnap({
        key: snapKey(id, slot),
        videoId: id,
        title: document.title.replace(/ - YouTube$/, ""),
        duration: v.duration,
        slot,
        cue: v.currentTime,
        percent: Math.round((v.currentTime / v.duration) * 1000) / 10,
        image,
        capturedAt: Date.now()
      });
      await paintCount();
    } catch (err) {
      if (titleEl) titleEl.textContent = "capture failed: " + err;
    } finally {
      busy = false;
    }
  }

  function parseRange(raw) {
    const m = String(raw || "").trim().match(/^(\d{8})-(\d{8})$/);
    if (!m) return null;
    const toDate = (s, end) => new Date(
      Number(s.slice(0, 4)),
      Number(s.slice(4, 6)) - 1,
      Number(s.slice(6, 8)),
      end ? 23 : 0,
      end ? 59 : 0,
      end ? 59 : 0,
      end ? 999 : 0
    );
    const start = toDate(m[1], false);
    const end = toDate(m[2], true);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
    return { start: start.getTime(), end: end.getTime(), label: m[1] + "-" + m[2] };
  }
  function safePart(s) {
    return String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function dirName(title, videoId, maxLen = folderMaxLen) {
    const len = clampFolderMaxLen(maxLen);
    const raw = String(title || "");
    const cut = raw.indexOf("---");
    const before = safePart(cut >= 0 ? raw.slice(0, cut) : raw) || "untitled";
    const after = cut >= 0 ? raw.slice(cut + 3) : raw;
    const nextPart = safePart(after).slice(0, len) || "untitled";
    return before + "__" + safePart(videoId) + "__" + nextPart;
  }
  function dataUrlBytes(dataUrl) {
    const i = String(dataUrl || "").indexOf(",");
    if (i < 0) throw new Error("bad image");
    const bin = atob(dataUrl.slice(i + 1));
    const out = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) out[n] = bin.charCodeAt(n);
    return out;
  }
  function crc32(bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ -1) >>> 0;
  }
  function u16(n) { return [n & 255, (n >> 8) & 255]; }
  function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
  function dosTimeDate(ms) {
    const d = new Date(Number.isFinite(ms) ? ms : Date.now());
    const year = Math.min(2107, Math.max(1980, d.getFullYear()));
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = Math.floor(d.getSeconds() / 2);
    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    const dosDate = ((year - 1980) << 9) | (month << 5) | day;
    return { dosTime, dosDate };
  }
  function buildStoredZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
      const name = new TextEncoder().encode(file.name);
      const data = file.bytes;
      const crc = crc32(data);
      const { dosTime, dosDate } = dosTimeDate(file.mtime);
      const utf8 = name.length !== file.name.length ? 0x0800 : 0;
      const local = [
        0x50, 0x4b, 0x03, 0x04,
        ...u16(20), ...u16(utf8), ...u16(0),
        ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(name.length), ...u16(0)
      ];
      locals.push(new Uint8Array(local), name, data);
      const central = [
        0x50, 0x4b, 0x01, 0x02,
        ...u16(20), ...u16(20), ...u16(utf8), ...u16(0),
        ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset)
      ];
      centrals.push(new Uint8Array(central), name);
      offset += local.length + name.length + data.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const part of centrals) centralSize += part.length;
    const end = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06,
      ...u16(0), ...u16(0),
      ...u16(files.length), ...u16(files.length),
      ...u32(centralSize), ...u32(centralStart),
      ...u16(0)
    ]);
    return new Blob([...locals, ...centrals, end], { type: "application/zip" });
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  
  
  
  
  function safeCueTag(sec) {
    return fmtTime(sec).replace(/:/g, "-");
  }
  function fmtStampDash(ms) {
    const d = new Date(Number.isFinite(ms) ? ms : Date.now());
    const p = (n) => String(n).padStart(2, "0");
    const ymd = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const hms = `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    return `${ymd}-${hms}`;
  }
  async function export2Dir() {
    const raw = prompt("Export range YYYYMMDD-YYYYMMDD", "20230101-20290101");
    if (raw == null || !String(raw).trim()) return;
    const range = parseRange(raw);
    if (!range) {
      alert("Bad range. Use YYYYMMDD-YYYYMMDD.");
      return;
    }
    const rows = (await allSnaps()).filter((row) => row.capturedAt >= range.start && row.capturedAt <= range.end);
    const byVideo = new Map();
    for (const row of rows) {
      const bag = byVideo.get(row.videoId) || [];
      bag.push(row);
      byVideo.set(row.videoId, bag);
    }
    const files = [];
for (const [id, list] of byVideo.entries()) {
      const folderStamp = fmtStampDash(newestAt(list));
      const baseFolder = dirName(list[0].title, id, folderMaxLen);
      const folder = `${folderStamp}_${baseFolder}`;
      for (const row of list) {
        if (!row.image) continue;
        const shotStamp = fmtStampDash(row.capturedAt || Date.now());
        const shotTime = safeCueTag(row.cue);
        const rawTitle = row.title || list[0].title || id;
        const title40 = safePart(rawTitle).slice(0, 40);
        const suffix = title40 ? `_${title40}` : "";
        const fileName = `${shotStamp}_slot${row.slot}_[${safePart(id)}][${safePart(shotTime)}]${suffix}.jpg`;
        files.push({
          name: folder + "/" + fileName,
          bytes: dataUrlBytes(row.image),
          mtime: row.capturedAt || Date.now()
        });
      }
    }
    if (!files.length) {
      alert("No snapshots in that range.");
      return;
    }
    downloadBlob(buildStoredZip(files), "yt-cue-snaps-" + range.label + ".zip");
  }
  function localSecretToggle(options) {
    const secret = options.secret || "zzvv";
    const buttonText = options.buttonText || "YT Cue";
    let keyBuffer = "";
    let button = null;
    function typing(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    }
    function createButton() {
      if (button) return;
      button = styleBtn(document.createElement("button"));
      button.type = "button";
      button.textContent = typeof buttonText === "function" ? buttonText() : buttonText;
      Object.assign(button.style, {
        position: "fixed",
        left: "8px",
        top: "8px",
        zIndex: "2147483647",
        background: "#c0392b",
        color: "#fff",
        border: "1px solid #888",
        borderRadius: "6px",
        padding: "6px 10px",
        cursor: "pointer"
      });
      button.addEventListener("click", () => {
        if (panel) panel.style.display = panel.style.display === "none" ? "" : "none";
      });
      document.documentElement.appendChild(button);
      if (options.onShow) options.onShow();
    }
    function removeButton() {
      if (button) button.remove();
      button = null;
      if (options.onHide) options.onHide();
    }
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (!e.key || e.key.length !== 1) return;
      keyBuffer = (keyBuffer + e.key.toLowerCase()).slice(-secret.length);
      if (keyBuffer !== secret) return;
      keyBuffer = "";
      if (button) removeButton();
      else createButton();
    }
    document.addEventListener("keydown", onKey, true);
    return { show: createButton, hide: removeButton };
  }
  let secretArmed = false;
  function armSecret() {
    if (secretArmed) return;
    secretArmed = true;
    const factory = globalThis.createSecretToggle || localSecretToggle;
    factory({
      secret: "zzvv",
      buttonText: "YT Cue",
      onShow: () => { if (panel) panel.style.display = ""; },
      onHide: () => { if (panel) panel.style.display = "none"; }
    });
  }
  function arm() {
    ensureUi();
    armSecret();
    paintCount().catch(() => {});
  }

  arm();
  setInterval(() => {
    arm();
    maybeCapture().catch(() => {});
  }, 500);
  //document.addEventListener("yt-navigate-finish", () => setTimeout(arm, 400));
})();
