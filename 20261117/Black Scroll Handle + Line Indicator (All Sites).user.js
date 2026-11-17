
// ==UserScript==
// @name         Black Scroll Handle + Line Indicator (All Sites)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Black thicker scrollbar + approximate first-visible text line near the bar
// @author       You
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const SB_WIDTH = 14;
    const EDGE_HIT = 24;
    const HIDE_MS = 800;

    GM_addStyle(`
        ::-webkit-scrollbar {
            width: ${SB_WIDTH}px !important;
            height: ${SB_WIDTH}px !important;
        }
        ::-webkit-scrollbar-thumb {
            background: #000000 !important;
            border-radius: 7px !important;
            border: 2px solid transparent !important;
            background-clip: content-box !important;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #222222 !important;
        }
        * {
            scrollbar-width: auto !important;
            scrollbar-color: #000000 transparent !important;
        }
        #tm-line-indicator {
            position: fixed;
            z-index: 2147483647;
            right: ${SB_WIDTH + 6}px;
            pointer-events: none;
            font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            color: #111;
            background: rgba(255, 255, 255, 0.78);
            border: 1px solid rgba(0, 0, 0, 0.28);
            border-radius: 4px;
            padding: 3px 6px;
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            box-shadow: 0 1px 4px rgba(0,0,0,0.18);
            opacity: 0;
            transform: translateY(-50%);
            transition: opacity 0.12s ease;
            user-select: none;
            white-space: nowrap;
        }
        #tm-line-indicator.tm-show { opacity: 1; }
    `);

    let box = null;
    let hideTimer = null;
    let dragging = false;
    let mouseX = 0;
    let mouseButtons = 0;
    let activeScroller = null;
    let raf = 0;

    function scrollingElementOf(target) {
        if (!target || target === document) {
            return document.scrollingElement || document.documentElement;
        }
        if (target.scrollHeight > target.clientHeight + 1) return target;
        return document.scrollingElement || document.documentElement;
    }

    function typicalLineHeight() {
        const nodes = document.querySelectorAll('article p, main p, p, li, td, h1, h2, h3, body');
        for (let i = 0; i < Math.min(nodes.length, 12); i++) {
            const cs = getComputedStyle(nodes[i]);
            let lh = parseFloat(cs.lineHeight);
            if (isNaN(lh) || lh < 10) {
                const fs = parseFloat(cs.fontSize);
                if (!isNaN(fs)) lh = fs * 1.5;
            }
            // keep only "text-like" line heights so a hero image doesn't freeze the count at L1
            if (!isNaN(lh) && lh >= 12 && lh <= 40) return lh;
        }
        return 18;
    }

    function approxFirstLine(scroller) {
        const el = scroller || scrollingElementOf(document);
        const top = el.scrollTop || window.scrollY || 0;
        const lh = typicalLineHeight();
        return Math.max(1, Math.floor(top / lh) + 1);
    }

    function thumbTopPx(scroller) {
        const el = scroller || scrollingElementOf(document);
        const max = Math.max(1, el.scrollHeight - el.clientHeight);
        const ratio = Math.min(1, Math.max(0, (el.scrollTop || 0) / max));
        return 12 + ratio * Math.max(40, window.innerHeight - 24);
    }

    function ensureBox() {
        if (box) return box;
        if (!document.documentElement) return null;
        box = document.createElement('div');
        box.id = 'tm-line-indicator';
        (document.body || document.documentElement).appendChild(box);
        return box;
    }

    function paint() {
        raf = 0;
        const el = ensureBox();
        if (!el) return;
        const scroller = activeScroller || scrollingElementOf(document);
        el.textContent = 'L' + approxFirstLine(scroller);
        el.style.top = thumbTopPx(scroller) + 'px';
    }

    function show(scroller) {
        if (scroller) activeScroller = scroller;
        const el = ensureBox();
        if (!el) return;
        el.classList.add('tm-show');
        if (!raf) raf = requestAnimationFrame(paint);
        clearTimeout(hideTimer);
    }

    function hideSoon() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!dragging && box) box.classList.remove('tm-show');
        }, HIDE_MS);
    }

    function isScrollbarInteraction() {
        return dragging || mouseButtons === 1 || mouseX >= window.innerWidth - EDGE_HIT;
    }

    if (0) document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseButtons = e.buttons;
        if (e.buttons === 1 && e.clientX >= window.innerWidth - EDGE_HIT) {
            dragging = true;
            show();
        }
    }, true);

    document.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        mouseButtons = 1;
        if (e.clientX >= window.innerWidth - EDGE_HIT) {
            dragging = true;
            show();
        }
    }, true);

    document.addEventListener('mouseup', () => {
        mouseButtons = 0;
        dragging = false;
        hideSoon();
    }, true);

    // capture: works for window scroll AND nested overflow containers
    document.addEventListener('scroll', (e) => {
        const scroller = scrollingElementOf(e.target);
        activeScroller = scroller;
        // native scrollbar drag often has no mousedown on the page,
        // but scroll still fires while the pointer is on the right edge / button held
        if (isScrollbarInteraction()) {
            dragging = mouseButtons === 1 || mouseX >= window.innerWidth - EDGE_HIT;
            show(scroller);
        }
    }, { capture: true, passive: true });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'PageUp' || e.key === 'PageDown') {
            requestAnimationFrame(() => {
                show(scrollingElementOf(document));
                hideSoon();
            });
        }
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureBox);
    } else {
        ensureBox();
    }
})();