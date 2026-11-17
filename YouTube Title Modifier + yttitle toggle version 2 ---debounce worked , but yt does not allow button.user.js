// ==UserScript==
// @name         YouTube Title Modifier + yttitle toggle version 2 ---debounce worked , but yt does not allow button
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Modify YouTube page title + secret "yttitle" button that shows live updateTitle count
// @author       Your Name
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
try{
    const LOG = (...args) => console.log('%c[YTMOD]', 'color:#0af;font-weight:bold', ...args);
    const WARN = (...args) => console.warn('%c[YTMOD]', 'color:orange;font-weight:bold', ...args);
    const ERR = (...args) => console.error('%c[YTMOD]', 'color:red;font-weight:bold', ...args);

    LOG('script evaluating…');

    // ===== Pause when mouse is over certain elements =====
    let isPaused = false;
    //'ytd-player',
        //'yt-thumbnail-view-model',
    const PAUSE_KEYWORDS = [
        
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
        } else isPaused = false;
    }, true);

    if (0) document.addEventListener('mouseout', (e) => {
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
        try {
            return (document.body?.innerText || "").toLowerCase().includes(str.toLowerCase()) ||
                   window.location.href.toLowerCase().includes(str.toLowerCase());
        } catch {
            return window.location.href.toLowerCase().includes(str.toLowerCase());
        }
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

    if (!String.prototype.sanitizeWindowsFilename) {
        Object.defineProperty(String.prototype, 'sanitizeWindowsFilename', {
            value: function() {
                return sanitizeWindowsFilename(this.toString());
            },
            enumerable: false,
            writable: true,
            configurable: true
        });
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
            LOG('Logged low-run URL to IndexedDB:', url, `(${count} runs)`);
        } catch (err) {
            ERR('IndexedDB write failed:', err);
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
                WARN(`updateTitle ran only ${runStats.count} time(s):`, runStats.url);
                logLowRunUrl(runStats.url, runStats.count);
            }
            runStats.url = currentUrl;
            runStats.count = 0;
            LOG('URL changed, reset count. New URL:', currentUrl);
        }

        runStats.count++;
        runStats.lastRun = Date.now();
        updateButtonCount();

        if (runStats.count === 1) {
            setTimeout(() => {
                if (runStats.url === currentUrl && runStats.count < 3) {
                    WARN(`Still only ${runStats.count} run(s) after 8s:`, currentUrl);
                    logLowRunUrl(currentUrl, runStats.count);
                }
            }, 8000);
        }
    }
    // ===================================

    function updateTitle() {
        //if (isPaused) return;

        try {
            trackRun();

            if (isPaused) {
                LOG('updateTitle skipped (paused)');
                return;
            }

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
                            const t = document.querySelector('title');
                            if (t) {
                                document.title = t.textContent + ` ytc_usermainpage ${formattedDate} ${formattedTime}  ${currentURL}`.sanitizeWindowsFilename();
                            }
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
        } catch (err) {
            ERR('updateTitle error:', err);
        }
    }

    // ===== Secret toggle button: type "yttitle" =====
    let keyBuffer = '';
    let logButton = null;
    let keyListenerAttached = false;
    let lastKey = '';
    let lastKeyTime = 0;

    function createLogButton() {
        if (logButton) {
            LOG('createLogButton: already exists');
            return;
        }

        LOG('createLogButton: creating…');
        logButton = document.createElement('button');
        logButton.textContent = `YT Logs (${runStats.count})`;
        logButton.id = 'yt-title-log-btn';
        logButton.style.cssText = `
            position: fixed !important;
            right: 8px !important;
            top: 8px !important;
            z-index: 2147483647 !important;
            padding: 6px 12px !important;
            background: #111 !important;
            color: #fff !important;
            border: none !important;
            border-radius: 4px !important;
            font: 12px/1.2 sans-serif !important;
            cursor: pointer !important;
            opacity: 0.9 !important;
            box-shadow: 0 2px 6px rgba(0,0,0,.4) !important;
        `;

        logButton.addEventListener('click', async () => {
            LOG('button clicked');
            try {
                const db = await openDB();
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => {
                    LOG('IndexedDB records:');
                    console.table(req.result);
                };
            } catch (err) {
                ERR('Failed to read IndexedDB:', err);
            }
        });

        const root = document.body || document.documentElement;
        if (!root) {
            ERR('No root element to append button');
            return;
        }
        root.appendChild(logButton);
        LOG('button appended to', root.tagName);
    }

    function removeLogButton() {
        if (logButton) {
            logButton.remove();
            logButton = null;
            LOG('button removed');
        }
    }

    function isTypingTarget(el) {
        if (!el || el === document || el === window) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || el.isContentEditable || el.getAttribute?.('contenteditable') === 'true';
    }

    function onSecretKey(e) {
        const key = (e.key || '').toLowerCase();
        const typing = isTypingTarget(e.target);
        const now = Date.now();

        // Debounce: ignore the same key if it arrives again within 40 ms
        if (key.length === 1 && key === lastKey && (now - lastKeyTime) < 40) {
            LOG(`keydown ignored (duplicate): "${key}"`);
            return;
        }

        if (key.length === 1) {
            lastKey = key;
            lastKeyTime = now;
            LOG(`keydown: "${key}"  typingTarget=${typing}  buffer="${keyBuffer}"  target=${e.target?.tagName || '?'}`);
        }

        if (typing) {
            keyBuffer = '';
            return;
        }

        if (key.length !== 1) return;

        keyBuffer = (keyBuffer + key).slice(-20);
        LOG(`buffer now: "${keyBuffer}"`);

        if (keyBuffer.includes('zzxx')) {
            LOG('*** SECRET SEQUENCE DETECTED ***');
            if (logButton) {
                removeLogButton();
            } else {
                createLogButton();
            }
            keyBuffer = '';
        }
    }

    function attachKeyListeners() {
        if (keyListenerAttached) {
            LOG('key listeners already attached — skipping');
            return;
        }
        document.addEventListener('keydown', onSecretKey, true);
        window.addEventListener('keydown', onSecretKey, true);
        keyListenerAttached = true;
        LOG('key listeners attached (document + window, capture)');
    }

    attachKeyListeners();

    // One delayed re-attach only (in case of early document replacement)
    setTimeout(() => {
        if (!keyListenerAttached) {
            LOG('delayed attach');
            attachKeyListeners();
        } else {
            LOG('delayed check: listeners already present');
        }
    }, 2000);

    // ================================================================

    // Expose for manual debugging
    window._ytTitleDebug = {
        createButton: createLogButton,
        removeButton: removeLogButton,
        stats: runStats,
        forceUpdate: updateTitle,
        getBuffer: () => keyBuffer,
        log: LOG
    };

    LOG('debug helpers exposed as window._ytTitleDebug');

    // Initial + recurring updates

    setInterval(updateTitle, 3000);
    if (0) setInterval(() => {
    if (!logButton) createLogButton();
}, 3000);
    LOG('script fully started — type yttitle (outside inputs) to toggle button');
    LOG('manual test: _ytTitleDebug.createButton()');
} catch (err) {
        console.error('[MyScript] failed to start:', err);
        alert('[MyScript] failed to start:\n' + (err && err.stack || err));
    }
})();
