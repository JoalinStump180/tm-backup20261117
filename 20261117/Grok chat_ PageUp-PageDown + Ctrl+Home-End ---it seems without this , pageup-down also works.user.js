
// ==UserScript==
// @name         Grok chat: PageUp/PageDown + Ctrl+Home/End   ---it seems without this , pageup/down also works
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Scroll the Grok conversation pane with PageUp/PageDown and Ctrl+Home/End even while the input is focused
// @author       You
// @match        *://grok.x.ai/*
// @match        *://grok.com/*
// @match        *://*.grok.com/*
// @match        *://x.com/i/grok*
// @match        *://x.com/grok*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    function isScrollable(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        const st = getComputedStyle(el);
        const oy = st.overflowY;
        if (!(oy === 'auto' || oy === 'scroll' || oy === 'overlay')) return false;
        return el.scrollHeight > el.clientHeight + 40;
    }

    function findChatScroller() {
        const all = document.querySelectorAll('div, main, section, article');
        let best = null;
        let bestArea = 0;
        for (const el of all) {
            if (!isScrollable(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 240 || r.height < 200) continue;
            // prefer the big center column
            if (r.left > window.innerWidth * 0.75) continue;
            const area = r.width * r.height;
            if (area > bestArea) {
                best = el;
                bestArea = area;
            }
        }
        return best || document.scrollingElement;
    }

    function pageSize(scroller) {
        return Math.max(80, Math.floor(scroller.clientHeight * 0.9));
    }

    function inEditable(el) {
        if (!el) return false;
        if (el.isContentEditable) return true;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select';
    }

    document.addEventListener('keydown', (e) => {
        if (e.altKey || e.metaKey) return;
        if (e.isComposing) return;

        const page = e.key === 'PageUp' || e.key === 'PageDown';
        const jump = e.ctrlKey && (e.key === 'Home' || e.key === 'End');
        if (!page && !jump) return;

        // Let the composer keep plain Home/End (cursor to start/end of line).
        // Only steal PageUp/PageDown and Ctrl+Home / Ctrl+End.
        const scroller = findChatScroller();
        if (!scroller) return;

        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'PageUp') {
            scroller.scrollBy({ top: -pageSize(scroller), behavior: 'auto' });
        } else if (e.key === 'PageDown') {
            scroller.scrollBy({ top: pageSize(scroller), behavior: 'auto' });
        } else if (e.key === 'Home') {
            scroller.scrollTo({ top: 0, behavior: 'auto' });
        } else if (e.key === 'End') {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
        }
    }, true);
})();