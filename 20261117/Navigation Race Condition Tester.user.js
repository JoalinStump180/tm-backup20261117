// ==UserScript==
// @name         Navigation Race Condition Tester
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Demonstrates missing logs on fast navigation (e.g., 0.7s clicks) vs immediate logging
// @author       You
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const DB_NAME = "NavigationTestDB";
  const STORE_NAME = "logs";

  // --- IndexedDB Helper ---
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function logToIDB(type, url, title) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.add({
        type,
        url,
        title,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("IDB Save Error:", err);
    }
  }

  async function getLogsFromIDB() {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  // --- Immediate vs Delayed Logging Demonstration ---
  function handleNavigationStart() {
    const testingActive = GM_getValue("test_active", false);
    if (!testingActive) return;

    const currentUrl = window.location.href;
    const currentTitle = document.title || "No Title Yet";

    // 1. Immediate Logging (Fix Concept)
    logToIDB("IMMEDIATE", currentUrl, currentTitle);

    // 2. Delayed Logging (Current Bugged Concept - Simulating async title resolution)
    // If user leaves within 0.7s, this timeout/promise is killed before completing!
    setTimeout(() => {
      logToIDB("DELAYED_3S", currentUrl, document.title || "Timeout Title");
    }, 3000);
  }

  // Intercept navigation & unload events
  window.addEventListener("beforeunload", handleNavigationStart);
  window.addEventListener("pagehide", handleNavigationStart);

  // --- UI Creation ---
  function createUI() {
    if (document.getElementById("nav-test-panel")) return;

    const panel = document.createElement("div");
    panel.id = "nav-test-panel";
    panel.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      color: #00ffcc;
      font-family: monospace;
      font-size: 12px;
      padding: 8px;
      border-radius: 6px;
      border: 1px solid rgba(0, 255, 204, 0.3);
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      width: 340px;
      pointer-events: auto;
    `;

    const btn = document.createElement("button");
    const isActive = GM_getValue("test_active", false);
    btn.textContent = isActive ? "Stop Testing" : "Start Testing";
    btn.style.cssText = `
      background: ${isActive ? "#ff4444" : "#00cc88"};
      color: white;
      border: none;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      margin-bottom: 6px;
      width: 100%;
    `;

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear IndexedDB Logs";
    clearBtn.style.cssText = `
      background: #444;
      color: #fff;
      border: none;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 6px;
      width: 100%;
      font-size: 10px;
    `;

    const logBox = document.createElement("textarea");
    logBox.readOnly = true;
    logBox.style.cssText = `
      width: 100%;
      height: 120px;
      background: transparent;
      color: #00ffcc;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      font-size: 10px;
      resize: vertical;
      box-sizing: border-box;
      outline: none;
    `;

    async function updateDisplay() {
      const logs = await getLogsFromIDB();
      logBox.value = logs
        .slice(-15)
        .reverse()
        .map(
          (l) =>
            `[${l.type}] ${l.timestamp.split("T")[1].slice(0, 8)}\nURL: ${l.url}\nTitle: ${l.title}\n---`
        )
        .join("\n");
    }

    btn.onclick = () => {
      const nextState = !GM_getValue("test_active", false);
      GM_setValue("test_active", nextState);
      btn.textContent = nextState ? "Stop Testing" : "Start Testing";
      btn.style.background = nextState ? "#ff4444" : "#00cc88";
    };

    clearBtn.onclick = async () => {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => updateDisplay();
    };

    panel.appendChild(btn);
    panel.appendChild(clearBtn);
    panel.appendChild(logBox);

    if (document.body) {
      document.body.appendChild(panel);
    } else {
      document.addEventListener("DOMContentLoaded", () => document.body.appendChild(panel));
    }

    updateDisplay();
    setInterval(updateDisplay, 1000);
  }

  // Initialize UI once DOM is available
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createUI);
  } else {
    createUI();
  }
})();