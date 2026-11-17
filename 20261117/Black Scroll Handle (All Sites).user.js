// ==UserScript==
// @name         Black Scroll Handle (All Sites)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Makes the scrollbar handle black and thicker on all websites
// @author       You
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(`
        /* Chrome / Edge / Safari */
        ::-webkit-scrollbar {
            width: 14px !important;
            height: 14px !important;
        }

        ::-webkit-scrollbar-thumb {
            background: #000000 !important;          /* black handle */
            border-radius: 7px !important;
            border: 2px solid transparent !important;
            background-clip: content-box !important;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #222222 !important;
        }

        /* Firefox */
        * {
            scrollbar-width: auto !important;
            scrollbar-color: #000000 transparent !important;  /* black handle */
        }
    `);
})();