// ==UserScript==
// @name         YouTube Shorts Clean Title → mock ---- title
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Detect clean Shorts title and set document.title to "mock ---- {title}"
// @author       You
// @match        https://www.youtube.com/shorts/*
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  function startShortsTitleWatcher(callback) {
    let lastCleanTitle = null;
    let lastUrl = location.href;

    function check(force = false) {
      const currentTitle = document.title;
      const currentUrl = location.href;

      // Only accept titles that do NOT contain "---"
      if (
        currentTitle &&
        !currentTitle.includes("---") &&
        (force || currentTitle !== lastCleanTitle || currentUrl !== lastUrl)
      ) {
        lastCleanTitle = currentTitle;
        lastUrl = currentUrl;

        if (typeof callback === "function") {
          callback(currentTitle, currentUrl);
        }
      }
    }

    // 1. Watch <title>
    const titleEl = document.querySelector("title");
    if (titleEl) {
      new MutationObserver(() => check()).observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    // 2. YouTube navigation events
    document.addEventListener("yt-navigate-finish", () => check());
    document.addEventListener("yt-page-data-updated", () => check());

    // 3. Light fallback
    setInterval(() => check(), 800);

    // Check current title immediately
    check(true);

    console.log("[Shorts Watcher] Started (only records titles without '---')");

    // Return a getter for the last clean title
    return function getLastCleanTitle() {
      return lastCleanTitle;
    };
  }

  // ===== Start the watcher =====
  const getLastTitle = startShortsTitleWatcher((cleanTitle, url) => {
    const newTitle = `mock ---- ${cleanTitle}`;
    document.title = newTitle;
    console.log("[Shorts Watcher] Title set to:", newTitle);
  });

  // Optional: expose the getter globally for testing in console
  window.getLastTitle = getLastTitle;
})();