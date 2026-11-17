// ==UserScript==
// @name         Grok plain code CSS
// @match        https://grok.com/*
// @match        https://x.com/i/grok*
// @grant        GM_addStyle
// ==/UserScript==

GM_addStyle(`
  pre, code, pre code,
  [class*="language-"],
  [class*="token"],
  span[class*="token"] {
    color: #e0e0e0 !important;
    background: transparent !important;
    font-weight: normal !important;
    font-style: normal !important;
    text-shadow: none !important;
  }
`);