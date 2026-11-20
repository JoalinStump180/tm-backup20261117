// ==UserScript==
// @name         YouTube Title Modifier
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Modify YouTube page title to include uploader's name (with mouse-pause support)
// @author       Your Name
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ===== Pause when mouse is over certain elements =====
    let isPaused = false;
        //ytd-player
    //const PAUSE_SELECTORS = 'ytd-player,ytd-progress-bar, ytp-progress-bar'; // add more selectors if needed
    //const PAUSE_SELECTORS = 'ytd-player, yt-thumbnail-view-model'; // add more selectors if needed
const PAUSE_KEYWORDS = [

        'progress-bar'
    ];

    function isInsidePauseZone(el) {
        if (!el || !(el instanceof Element)) return false;

        let current = el;
        // Walk up the DOM tree (supporting shadow DOM boundaries if needed)
        while (current && current !== document.documentElement) {
            const tag = (current.tagName || "").toLowerCase();
            const id = (current.id || "").toLowerCase();
            const className = typeof current.className === 'string' ? current.className.toLowerCase() : "";

            // Check if any keyword matches tag, id, or class as a substring
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

    // Placeholder – replace with your real implementation if needed
    function findStrings2(str) {
        // Example stub: check page text or URL
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
        // Currently a no-op as in original; uncomment to actually sanitize
        // const reservedChars = /[<>:"/\\|?*\x00-\x1f]/g;
        // return filename.replace(reservedChars, '_');
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

    function updateTitle() {
        if (isPaused) return; // <-- pause while mouse is over player/thumbnail zones

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

    // Initial + recurring updates
   // setTimeout(updateTitle, 1000);
   // setTimeout(updateTitle, 2000);
    //setTimeout(updateTitle, 4000);
   // setTimeout(updateTitle, 6000);
   // setTimeout(updateTitle, 8000);
   // setTimeout(updateTitle, 10000);
    setInterval(updateTitle, 3000);

    // Optional: re-enable MutationObserver if desired (it is still guarded by isPaused)
    // function onMutations() {
    //     if (isPaused) return;
    //     updateTitle();
    // }
    // const observer = new MutationObserver(onMutations);
    // observer.observe(document.body, { childList: true, subtree: true });

})();
