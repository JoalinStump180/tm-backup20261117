// ==UserScript==
// @name         Visible Text Extractor + Flask Sender 1.5
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Extract new visible text (delta) and send to Flask via GM_xmlhttpRequest
// @match        *://*.youtube.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const uniqueTexts = new Set();
    let isRunning = false;
    let observer = null;

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight * 1.6 && rect.bottom > -150;
    }

    function sendToFlask(text) {
        GM_xmlhttpRequest({
            method: "POST",
            url: "http://127.0.0.1:5000/log_input",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ text: text }),
            onload: function() {
                // console.log("Sent:", text.substring(0, 50) + "...");
            },
            onerror: function(err) {
                console.error("Failed to send to Flask:", err);
            }
        });
    }

    function collectNewText() {
        let added = 0;
        const newItems = [];

        // Strong YouTube + general selectors
        const elements = document.querySelectorAll(`
            ytd-comment-renderer,
            ytd-comment-thread-renderer,
            #content-text,

        `);
        //            yt-formatted-string,
           // p, div, span, h1, h2, h3, article, section

        elements.forEach(el => {
            if (el.hasAttribute('data-extracted')) return;

            let text = (el.innerText || el.textContent || "").trim();

            if (text.length > 8 && !uniqueTexts.has(text)) {
                uniqueTexts.add(text);
                newItems.push(text);
                added++;
                el.setAttribute('data-extracted', 'true');
text =text.replace(/[\n\r]+/g, ' ');
                // Send to Flask immediately
                sendToFlask(window.location.href+' '+text);
            }
        });
//if (newItems.length > 0)
        if ( 0) {
            console.log(`%c[+${newItems.length} new] (Total: ${uniqueTexts.size})`, 'color:lime;font-weight:bold');
            console.log(newItems.join('\n\n'));
        }
    }

    function start() {
        if (isRunning) return;
        isRunning = true;

        console.log('?? Visible Text Extractor + Flask Sender started');

        const run = () => collectNewText();

        setTimeout(run, 1000);
        setTimeout(run, 3500);
        setTimeout(run, 7000);
        setTimeout(run, 13000);

        observer = new MutationObserver(() => setTimeout(run, 500));
        observer.observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener('scroll', () => setTimeout(run, 600), { passive: true });
    }

    window.startExtractor = start;
    window.stopExtractor = () => {
        isRunning = false;
        if (observer) observer.disconnect();
        console.log('?? Stopped. Total:', uniqueTexts.size);
    };

     //start state
    window.addEventListener('load', start);
    setTimeout(start, 800);

    // Floating button
    setTimeout(() => {
        const btn = document.createElement('button');
        btn.textContent = '? Stop Extractor';
        btn.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:999999;padding:12px 16px;background:#d32f2f;color:white;border:none;border-radius:8px;cursor:pointer;`;
        btn.onclick = () => {
            if (isRunning) {
                window.stopExtractor();
                btn.textContent = '? Start';
                btn.style.background = '#388e3c';
            } else {
                window.startExtractor();
                btn.textContent = '? Stop';
                btn.style.background = '#d32f2f';
            }
        };
        document.body.appendChild(btn);
    }, 2000);
})();