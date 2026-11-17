// ==UserScript==
// @name         YouTube Title Modifier + yttitle toggle version 1
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Modify YouTube page title + secret "yttitle" button that shows live updateTitle count
// @author       Your Name
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ===== Pause when mouse is over certain elements =====
    let isPaused = false;
    const PAUSE_KEYWORDS = [
        'ytd-player',
        'yt-thumbnail-view-model',
        'progress-bar'
    ];

    function isInsidePauseZone(el) {
        if (!el || !(el instanceof Element)) return false;

        let current = el;
        while (current && current !== document.documentElement) {
            const tag = (current.tagName || "").toLowerCase();
            const id = (current.id || "").toLowerCase();
            const className = typeof current.className === 'string' ? current.className.toLowerCase() : "";

            for (const keyword of PAUSE_KEYWORDS) {
                const kw = keyword.toLowerCase();
                if (tag.includes(kw) || id.includes(kw) || className.includes(kw)) {
                    return true;
                }
            }

            current = current.parentElement || (current.getRootNode && current.getRootNode().host);
        }
        return false;
    }

    document.addEventListener('mouseover', (e) => {
        if (isInsidePauseZone(e.target)) {
            isPaused = true;
        }
    }, true);

    document.addEventListener('mouseout', (e) => {
        if (isInsidePauseZone(e.target)) {
            if (!isInsidePauseZone(e.relatedTarget)) {
                isPaused = false;
            }
        }
    }, true);
    // =====================================================

    let myaccountprefix = "myaccount - ";
    let lastprefix = "";

    function findStrings2(str) {
        return document.body?.innerText?.toLowerCase().includes(str.toLowerCase()) ||
               window.location.href.toLowerCase().includes(str.toLowerCase());
    }

    function refreshPrefix() {
        lastprefix = myaccountprefix;
        if (findStrings2("martin guptile") || findStrings2("guptilemartin")) {
            myaccountprefix = "martin - ";
        }
        if (findStrings2("nathan lowry") || findStrings2("archibaldflowers")) {
            myaccountprefix = "archi - ";
        }
        if (findStrings2("kuraki mai") || findStrings2("holptbjdd") || findStrings2("nile farcell")) {
            myaccountprefix = "hol - ";
        }
    }

    function getShortsUploader2() {
        const shortsLink = document.querySelector('a[href*="/@"][href*="/shorts"]');
        const watchPageLink = document.querySelector('#owner #channel-name a[href^="/@"], #owner #channel-name a[href^="/channel/"]');
        const targetLink = shortsLink || watchPageLink;

        if (!targetLink) return null;

        const href = targetLink.getAttribute('href');
        const match = href.match(/(@[^/?#]+|\/channel\/[a-zA-Z0-9_-]+)/);
        return match ? match[0] : null;
    }

    function sanitizeWindowsFilename(filename) {
        return filename;
    }

    Object.defineProperty(String.prototype, 'sanitizeWindowsFilename', {
        value: function() {
            return sanitizeWindowsFilename(this.toString());
        },
        enumerable: false,
        writable: true,
        configurable: true
    });

    function getTitle() {
        const watchTitle = document.querySelector('h1.ytd-watch-metadata');
        if (watchTitle) return watchTitle.textContent.trim();

        const shortsTitle = document.querySelector('yt-dynamic-text-view-model.ytPageHeaderViewModelTitle:nth-child(2) > h1:nth-child(1)');
        if (shortsTitle) return shortsTitle.textContent.trim();

        return document.title.replace(" - YouTube", "");
    }

    // ===== Run counter + IndexedDB =====
    const runStats = {
        url: '',
        count: 0,
        lastRun: 0
    };

    const DB_NAME = 'YTTitleMonitor';
    const DB_VERSION = 1;
    const STORE_NAME = 'lowRunUrls';
    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('url', 'url', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    async function logLowRunUrl(url, count) {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.add({
                url,
                count,
                timestamp: Date.now(),
                date: new Date().toISOString()
            });
            console.log('%c[YT Title] Logged low-run URL to IndexedDB:', 'color: #0a0', url, `(${count} runs)`);
        } catch (err) {
            console.error('[YT Title] IndexedDB write failed:', err);
        }
    }

    function updateButtonCount() {
        if (logButton) {
            logButton.textContent = `YT Logs (${runStats.count})`;
        }
    }

    function trackRun() {
        const currentUrl = location.href.split('&')[0];

        if (runStats.url !== currentUrl) {
            if (runStats.url && runStats.count < 3) {
                console.warn(
                    `%c[YT Title] updateTitle ran only ${runStats.count} time(s):`,
                    'color: orange; font-weight: bold',
                    runStats.url
                );
                logLowRunUrl(runStats.url, runStats.count);
            }
            runStats.url = currentUrl;
            runStats.count = 0;
        }

        runStats.count++;
        runStats.lastRun = Date.now();
        updateButtonCount();

        if (runStats.count === 1) {
            setTimeout(() => {
                if (runStats.url === currentUrl && runStats.count < 3) {
                    console.warn(
                        `%c[YT Title] Still only ${runStats.count} run(s) after 8s:`,
                        'color: red; font-weight: bold',
                        currentUrl
                    );
                    logLowRunUrl(currentUrl, runStats.count);
                }
            }, 8000);
        }
    }
    // ===================================

    function updateTitle() {
        trackRun();

        if (isPaused) return;

        const currentURL = window.location.href;
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const formattedDate = `${year}${month}${day}`;
        const formattedTime = 'time' +
            String(date.getHours()).padStart(2, '0') +
            String(date.getMinutes()).padStart(2, '0') +
            String(date.getSeconds()).padStart(2, '0');

        const uploaderElement = document.querySelector('h3#title.style-scope.ytd-video-description-infocards-section-renderer');
        const title3 = document.querySelector('title')?.textContent.trim() ?? "";

        refreshPrefix();
        if (lastprefix && lastprefix !== myaccountprefix) {
            document.title = document.title.replaceAll(lastprefix, myaccountprefix);
        }

        if (window.location.href.includes('youtube.com')) {
            if (!document.title.includes(myaccountprefix)) {
                if (window.location.href.includes('/watch') || window.location.href.includes('youtube.com/short')) {
                    const title1 = document.querySelector('h1.ytd-watch-metadata')?.textContent.trim() ?? "";
                    const title2 = document.querySelector('yt-dynamic-text-view-model.ytPageHeaderViewModelTitle:nth-child(2) > h1:nth-child(1)')?.textContent.trim() ?? "";
                    const uploader1 = decodeURI(uploaderElement?.textContent.slice(0, 25) ?? "");
                    const uploader2 = decodeURI(getShortsUploader2() ?? "");

                    if (window.location.href.includes('/watch')) {
                        document.title = `${uploader1}${uploader2} ---- ${myaccountprefix}${title1}[${formattedDate}] ${formattedTime}  ${currentURL}`.sanitizeWindowsFilename();
                    }
                    if (window.location.href.includes('youtube.com/short')) {
                        document.title = `${uploader2} ---- ${title2}[${formattedDate}] ${formattedTime}  ${currentURL}`.sanitizeWindowsFilename();
                    }
                } else if (window.location.href.includes('www.youtube.com/@') || window.location.href.includes('www.youtube.com/channel')) {
                    if (!document.title.includes('playlist') && !document.title.includes('ytc_usermainpage')) {
                        document.title = document.querySelector('title').textContent + ` ytc_usermainpage ${formattedDate} ${formattedTime}  ${currentURL}`.sanitizeWindowsFilename();
                    }
                } else {
                    document.title = `${title3} ${myaccountprefix}${formattedDate} ${formattedTime} ${currentURL}`.sanitizeWindowsFilename();
                }
            }
        }

        if (!window.location.href.includes('youtube.com')) {
            if (window.location.href.includes('google.com') ||
                window.location.href.includes('gmail.com') ||
                window.location.href.includes('bing.com') ||
                window.location.href.includes('grok.com') ||
                window.location.href.includes('taobao.com') ||
                window.location.href.includes('chatgpt.com')) {
                if (!document.title.includes(myaccountprefix)) {
                    document.title = `${myaccountprefix}${document.title}`;
                }
            } else {
                if (!document.title.includes(formattedDate)) {
                    document.title = `${title3} ytc_none ${formattedDate} ${formattedTime} ${currentURL}`.sanitizeWindowsFilename();
                }
            }
        }
    }

    // ===== Secret toggle button: type "yttitle" =====
    let keyBuffer = '';
    let logButton = null;

    function createLogButton() {
        if (logButton) return;

        logButton = document.createElement('button');
        logButton.textContent = `YT Logs (${runStats.count})`;
        logButton.style.cssText = `
            position: fixed;
            left: 8px;
            top: 8px;
            z-index: 2147483647;
            padding: 6px 10px;
            background: #111;
            color: #fff;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            opacity: 0.85;
        `;

        logButton.addEventListener('click', async () => {
            try {
                const db = await openDB();
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => {
                    console.log('%c[YT Title] IndexedDB records:', 'color: #0af; font-weight: bold');
                    console.table(req.result);
                };
            } catch (err) {
                console.error('[YT Title] Failed to read IndexedDB:', err);
            }
        });

        (document.documentElement || document.body).appendChild(logButton);
    }

    function removeLogButton() {
        if (logButton) {
            logButton.remove();
            logButton = null;
        }
    }

    function handleSecretKeys(e) {
        const t = e.target;
        if (t && (t.matches?.('input, textarea, [contenteditable]') || t.isContentEditable)) {
            keyBuffer = '';
            return;
        }

        if (e.key && e.key.length === 1) {
            keyBuffer = (keyBuffer + e.key).slice(-20);
            if (keyBuffer.endsWith('yttitle')) {
                if (logButton) {
                    removeLogButton();
                } else {
                    createLogButton();
                }
                keyBuffer = '';
            }
        }
    }

    document.addEventListener('keydown', handleSecretKeys, true);
    // ================================================

    // Initial + recurring updates
    setTimeout(updateTitle, 1000);
    setTimeout(updateTitle, 2000);
    setTimeout(updateTitle, 4000);
    setTimeout(updateTitle, 6000);
    setTimeout(updateTitle, 8000);
    setTimeout(updateTitle, 10000);
    setInterval(updateTitle, 3000);

})();
