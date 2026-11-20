
// ==UserScript==
// @name         Grok Plain Mode
// @match        https://grok.com/*
// @match        https://x.com/i/grok*
// @match        https://grok.x.ai/*
// @grant        GM_addStyle
// ==/UserScript==

GM_addStyle(`
*, *::before, *::after {
  color: #e0e0e0 !important;
  background: transparent !important;
  background-image: none !important;
  border: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  font-weight: normal !important;
  font-style: normal !important;
  text-decoration: none !important;
}

pre, code, pre code,
[class*="language-"],
[class*="token"],
span[class*="token"] {
  color: #e0e0e0 !important;
  background: transparent !important;
  font-weight: normal !important;
}
`);