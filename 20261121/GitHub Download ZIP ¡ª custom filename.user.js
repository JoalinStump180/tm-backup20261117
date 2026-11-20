// ==UserScript==
// @name         GitHub Download ZIP ¡ª custom filename
// @namespace    local.github.zip-rename
// @version      1.2.1
// @description  Intercept Code ¡ú Download ZIP, custom name, on-screen status
// @author       you
// @match        https://github.com/*
// @grant        GM_download
// @grant        GM.download
// @connect      github.com
// @connect      codeload.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const NAME_MODE = "prompt"; // "prompt" | "auto"
  const TIMEOUT_MS = 180000;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function ensureHud() {
    let box = $("#gh-zip-hud");
    if (box) return box;
    box = document.createElement("div");
    box.id = "gh-zip-hud";
    box.innerHTML =
      '<div class="t"></div><div class="d"></div><div class="bar"><i></i></div>';
    Object.assign(box.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      minWidth: "260px",
      maxWidth: "360px",
      padding: "10px 12px",
      borderRadius: "10px",
      background: "rgba(17,17,17,.72)",
      color: "#fff",
      font: "12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,.35)",
      backdropFilter: "blur(8px)",
      display: "none",
      pointerEvents: "none",
    });
    const style = document.createElement("style");
    style.textContent = `
      #gh-zip-hud .t{font-weight:600;margin-bottom:4px}
      #gh-zip-hud .d{opacity:.85;word-break:break-all}
      #gh-zip-hud .bar{display:none;height:4px;margin-top:8px;background:rgba(255,255,255,.2);border-radius:99px;overflow:hidden}
      #gh-zip-hud .bar i{display:block;height:100%;width:0;background:#3fb950}
    `;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(box);
    return box;
  }

  function hud(title, detail, pct) {
    const box = ensureHud();
    $(".t").textContent = title || "";
    $(".d").textContent = detail || "";
    const bar = $(".bar");
    const i = $("i", bar);
    if (pct == null || Number.isNaN(pct)) {
      bar.style.display = "none";
    } else {
      bar.style.display = "block";
      i.style.width = Math.max(0, Math.min(100, pct)) + "%";
    }
    box.style.display = "block";
  }

  function hudHide(ms) {
    setTimeout(() => {
      const box = $("#gh-zip-hud");
      if (box) box.style.display = "none";
    }, ms || 0);
  }

  function gmDownload(opts) {
    const fn =
      typeof GM !== "undefined" && GM.download
        ? GM.download
        : typeof GM_download === "function"
          ? GM_download
          : null;
    if (!fn) return Promise.reject(new Error("GM_download is not available"));
    return new Promise((resolve, reject) => {
      const started = Date.now();
      fn({
        ...opts,
        onprogress: (e) => {
          const loaded = e.loaded || e.lengthComputable && e.loaded;
          const total = e.total;
          const sec = ((Date.now() - started) / 1000).toFixed(0);
          if (total) {
            const pct = (loaded / total) * 100;
            hud(
              "Downloading ZIP¡­",
              `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB  (${sec}s)`,
              pct
            );
          } else {
            hud(
              "Waiting for GitHub¡­",
              loaded
                ? `${(loaded / 1048576).toFixed(1)} MB so far  (${sec}s)`
                : `No bytes yet  (${sec}s)\nArchive is often generated on demand`,
              loaded ? 5 : 2
            );
          }
          if (typeof opts.onprogress === "function") opts.onprogress(e);
        },
        onload: resolve,
        onerror: (e) => reject(e?.error || e || new Error("download error")),
        ontimeout: () => reject(new Error("timeout after " + TIMEOUT_MS / 1000 + "s")),
      });
    });
  }

  function repoParts() {
    const p = location.pathname.split("/").filter(Boolean);
    return { owner: p[0], repo: p[1] };
  }

  function sanitize(name) {
    return String(name)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pathRef() {
    const path = location.pathname;
    const m =
      path.match(/\/(?:tree|blob|commits)\/([^/?#]+)/) ||
      path.match(/\/commit\/([0-9a-f]{7,40})/i) ||
      path.match(/\/releases\/tag\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function archiveHrefFrom(el) {
    const a = el?.closest?.("a[href]");
    if (!a) return null;
    const href = a.href || "";
    if (/\/archive\/.+\.zip(?:$|\?)/i.test(href)) return href;
    if (/codeload\.github\.com\//i.test(href)) return href;
    return null;
  }

  function isDownloadZipLink(el) {
    if (!el || el.nodeType !== 1) return false;
    const a = el.closest("a[href], button");
    if (!a) return false;
    const href = a.getAttribute("href") || a.href || "";
    const text = (a.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const ga = a.getAttribute("data-ga-click") || "";
    return (
      /\/archive\/.*\.zip(?:$|\?)/i.test(href) ||
      text.includes("download zip") ||
      ga.includes("download zip")
    );
  }

  async function downloadCustomZip(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    const { owner, repo } = repoParts();
    if (!owner || !repo) {
      hud("Not a repo page", location.pathname);
      hudHide(2500);
      return;
    }

    const url = archiveHrefFrom(ev.target);
    if (!url) {
      hud("No ZIP URL on this control", "Click the real Download ZIP item");
      hudHide(3000);
      return;
    }

    const ref = pathRef() || "HEAD";
    let filename = `${owner}_${repo}_${sanitize(ref)}.zip`;

    hud("Save as¡­", filename);
    if (NAME_MODE === "prompt") {
      const typed = window.prompt("Save ZIP as:", filename);
      if (typed === null) {
        hud("Cancelled", "");
        hudHide(800);
        return;
      }
      filename = typed.trim() || filename;
    }
    if (!/\.zip$/i.test(filename)) filename += ".zip";

    hud("Contacting GitHub¡­", url.split("?")[0], 1);
    const t0 = Date.now();
    try {
      await gmDownload({
        url,
        name: filename,
        saveAs: true,
        timeout: TIMEOUT_MS,
      });
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      hud("Done", filename + "  (" + sec + "s)", 100);
      hudHide(4000);
    } catch (err) {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      const msg = err && err.message ? err.message : String(err);
      hud("Failed after " + sec + "s", msg + "\n" + url);
      console.error("[gh-zip-rename]", err);
      setTimeout(
        () => alert("Download failed: " + msg + "\n" + url),
        50
      );
    }
  }

  document.addEventListener(
    "click",
    (ev) => {
      if (!isDownloadZipLink(ev.target)) return;
      downloadCustomZip(ev);
    },
    true
  );
})();