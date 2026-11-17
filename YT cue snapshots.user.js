// ==UserScript==
// @name         YT cue snapshots
// @namespace    local.yt-cue-snaps
// @version      0.1.0
// @description  Detect YouTube ad/play stage and save up to 3 viewport snapshots per video.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const DB_NAME = "ytCueSnaps";
  const DB_VERSION = 1;
  const STORE = "snaps";
  const SLOT1_AFTER = 10;
  const SLOT2_FROM = 60;
  const SLOT2_TO = 150;
  const SLOT3_FROM = 150;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex("byVideo", "videoId");
          store.createIndex("bySlot", "slot");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function snapKey(videoId, slot) {
    return videoId + "|" + slot;
  }

  async function getSnap(videoId, slot) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(snapKey(videoId, slot));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function putSnap(row) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function allSnaps() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function snapsFor(videoId) {
    const rows = await allSnaps();
    return rows.filter((r) => r.videoId === videoId).sort((a, b) => a.slot - b.slot);
  }

  async function deleteWhere(pred) {
    const rows = await allSnaps();
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const row of rows) {
        if (pred(row)) store.delete(row.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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

  function playerVideoId() {
    const p = player();
    try {
      if (p && typeof p.getVideoData === "function") {
        const data = p.getVideoData() || {};
        if (data.video_id) return data.video_id;
      }
    } catch {}
    return "";
  }

  function playerState() {
    const p = player();
    try {
      if (p && typeof p.getPlayerState === "function") return p.getPlayerState();
    } catch {}
    return null;
  }

  function playerResetting() {
    const p = player();
    if (!p) return true;
    if (p.classList.contains("unstarted-mode") || p.classList.contains("ended-mode") || p.classList.contains("buffering-mode")) return true;
    const st = playerState();
    return st === -1 || st === 0 || st === 3 || st === 5;
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

  let panel, titleEl, bodyEl, listEl, minBtn;
  let searchBox, onlyHitsBox, hitCountEl;
  let expanded = false;
  let busy = false;
  let hitIndex = 0;
  let hitRows = [];

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
    minBtn = document.createElement("button");
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
    bar.append(titleEl, minBtn);

    bodyEl = document.createElement("div");
    bodyEl.style.display = "none";
    bodyEl.style.padding = "6px";
    bodyEl.style.maxHeight = "70vh";
    bodyEl.style.overflow = "auto";

    const actions = document.createElement("div");
    actions.style.marginBottom = "8px";
    for (const [label, from] of [["clear 1 and up", 1], ["clear 2 and up", 2], ["clear all", 1]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.marginRight = "4px";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        clearSlots(from);
      });
      actions.appendChild(b);
    }
    const viewAll = document.createElement("button");
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
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = "clear all videos";
    all.addEventListener("click", (e) => {
      e.stopPropagation();
      clearSlots(1, "*");
    });
    actions.appendChild(all);

    const searchRow = document.createElement("div");
    searchRow.style.display = "flex";
    searchRow.style.alignItems = "center";
    searchRow.style.gap = "6px";
    searchRow.style.marginBottom = "8px";
    searchBox = document.createElement("input");
    searchBox.type = "search";
    searchBox.placeholder = "Search title, url, length";
    searchBox.style.flex = "1";
    searchBox.style.minWidth = "120px";
    searchBox.addEventListener("input", () => {
      hitIndex = 0;
      openPanel();
    });
    const onlyLabel = document.createElement("label");
    onlyLabel.style.whiteSpace = "nowrap";
    onlyHitsBox = document.createElement("input");
    onlyHitsBox.type = "checkbox";
    onlyHitsBox.addEventListener("change", () => {
      hitIndex = 0;
      openPanel();
    });
    onlyLabel.append(onlyHitsBox, document.createTextNode(" only hits"));
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "prev hit";
    prev.addEventListener("click", (e) => { e.stopPropagation(); stepHit(-1); });
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "next hit";
    next.addEventListener("click", (e) => { e.stopPropagation(); stepHit(1); });
    hitCountEl = document.createElement("span");
    hitCountEl.textContent = "0 / 0";
    hitCountEl.style.minWidth = "48px";
    searchRow.append(searchBox, onlyLabel, prev, next, hitCountEl);

    listEl = document.createElement("div");
    bodyEl.append(actions, searchRow, listEl);
    panel.append(bar, bodyEl);
    document.documentElement.appendChild(panel);

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
    const b = document.createElement("button");
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
  function markHit(tr, on) {
    tr.style.background = on ? "#cce8ff" : "";
  }
  function showHit() {
    hitRows.forEach((row, i) => markHit(row.tr, i === hitIndex && hitRows.length > 0));
    if (!hitRows.length) {
      if (hitCountEl) hitCountEl.textContent = "0 / 0";
      return;
    }
    hitIndex = (hitIndex + hitRows.length) % hitRows.length;
    if (hitCountEl) hitCountEl.textContent = (hitIndex + 1) + " / " + hitRows.length;
    const row = hitRows[hitIndex];
    if (row && row.tr && row.tr.scrollIntoView) row.tr.scrollIntoView({ block: "nearest" });
  }
  function stepHit(dir) {
    const q = (searchBox && searchBox.value || "").trim();
    if (!q || !hitRows.length) return;
    hitIndex = (hitIndex + dir + hitRows.length) % hitRows.length;
    showHit();
  }
  async function openPanel() {
    if (!listEl) return;
    const rows = await allSnaps();
    const byVideo = new Map();
    for (const row of rows) {
      const bag = byVideo.get(row.videoId) || [];
      bag.push(row);
      byVideo.set(row.videoId, bag);
    }
    const q = (searchBox && searchBox.value || "").trim().toLowerCase();
    const onlyHits = !!(onlyHitsBox && onlyHitsBox.checked);
    listEl.replaceChildren();
    hitRows = [];
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
    const entries = [...byVideo.entries()].sort((a, b) => {
  const newest = (list) => Math.max(...list.map((row) => row.capturedAt || 0));
  return newest(b[1]) - newest(a[1]);
});;
    const visible = entries.filter(([id, list]) => {
      if (!q) return true;
      const first = list[0];
      const hay = [first.title, videoUrl(id), id, fmtTime(first.duration)].join(" ").toLowerCase();
      const hit = hay.includes(q);
      return onlyHits ? hit : true;
    });
    if (!visible.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = q ? "No hits." : "No snapshots yet.";
      td.style.padding = "12px";
      td.style.color = "#777";
      tr.appendChild(td);
      tb.appendChild(tr);
    }
    for (const [id, list] of visible) {
      list.sort((a, b) => a.slot - b.slot);
      const first = list[0];
      const hay = [first.title, videoUrl(id), id, fmtTime(first.duration)].join(" ").toLowerCase();
      const isHit = !!q && hay.includes(q);
      const stamp = stampParts(Math.min(...list.map((x) => x.capturedAt || Date.now())));
      const tr = document.createElement("tr");
      tr.append(
        cell(stamp.date, "90px"),
        cell(stamp.time, "70px"),
        cell(first.title || id, "180px"),
        cell(videoUrl(id)),
        cell(fmtTime(first.duration), "60px")
      );
      tb.appendChild(tr);
      if (isHit) hitRows.push({ tr, id });

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
        shot.style.width = "180px";
        shot.style.flex = "0 0 180px";
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
          img.style.width = "180px";
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
    }
    table.appendChild(tb);
    listEl.appendChild(table);
    if (!q) {
      hitIndex = 0;
      if (hitCountEl) hitCountEl.textContent = "0 / 0";
      return;
    }
    if (hitIndex >= hitRows.length) hitIndex = 0;
    showHit();
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

  function sameSlot(cue, duration, slot) {
    return slotFor(cue, duration) === slot;
  }
  async function maybeCapture() {
    if (busy) return;
    const id = videoIdFromLocation();
    const v = videoEl();
    if (!id || !v || stage() !== "play") return;
    if (v.seeking || v.readyState < 3 || !Number.isFinite(v.duration) || v.duration <= 0) return;
    if (playerResetting()) return;
    const playingId = playerVideoId();
    if (playingId && playingId !== id) return;
    const cueAtChoice = v.currentTime;
    const durationAtChoice = v.duration;
    const slot = slotFor(cueAtChoice, durationAtChoice);
    if (!slot) return;
    if (await getSnap(id, slot)) return;
    if (videoIdFromLocation() !== id) return;
    if (videoEl() !== v) return;
    if (v.seeking || v.readyState < 3 || playerResetting()) return;
    const playingIdAfter = playerVideoId();
    if (playingIdAfter && playingIdAfter !== id) return;
    const cueNow = v.currentTime;
    if (!sameSlot(cueNow, v.duration, slot)) return;
    busy = true;
    try {
      const image = captureFrame(v);
      const cueSaved = v.currentTime;
      if (!sameSlot(cueSaved, v.duration, slot)) return;
      await putSnap({
        key: snapKey(id, slot),
        videoId: id,
        title: document.title.replace(/ - YouTube$/, ""),
        duration: v.duration,
        slot,
        cue: cueSaved,
        percent: Math.round((cueSaved / v.duration) * 1000) / 10,
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

  function arm() {
    ensureUi();
    paintCount().catch(() => {});
  }

  arm();
  setInterval(() => {
    arm();
    maybeCapture().catch(() => {});
  }, 500);
  document.addEventListener("yt-navigate-finish", () => setTimeout(arm, 400));
})();
