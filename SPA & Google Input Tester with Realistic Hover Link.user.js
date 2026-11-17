// ==UserScript==
// @name         SPA & Google Input Tester with Realistic Hover Link
// @namespace    http://tampermonkey.net/
// @version      3.6
// @description  Floating panel with URL push, Google input injector, and a link that shows realistic URLs on hover without jumping
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // Create floating test container
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed;
    top: 50px;
    right: 20px;
    z-index: 999999;
    background: #1e1e1e;
    color: #00ffcc;
    font-family: monospace;
    font-size: 12px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid #00ffcc;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    width: 270px;
    box-sizing: border-box;
  `;

  // Header layout with title and fold/unfold button
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    border-bottom: 1px solid rgba(0,255,204,0.3);
    padding-bottom: 6px;
  `;

  const title = document.createElement('span');
  title.innerHTML = '<b>Dual Tester Panel</b>';

  const foldBtn = document.createElement('button');
  foldBtn.textContent = '[-]';
  foldBtn.style.cssText = `
    background: #333;
    color: #00ffcc;
    border: 1px solid #00ffcc;
    border-radius: 3px;
    cursor: pointer;
    padding: 1px 6px;
    font-family: monospace;
    font-size: 11px;
  `;

  header.appendChild(title);
  header.appendChild(foldBtn);
  panel.appendChild(header);

  // Content body container
  const bodyContainer = document.createElement('div');
  bodyContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;

  // Independent counters
  let urlCount = 1;
  let inputCount = 1;
  let linkCount = 1;

  // --- Button 1: URL PushState Incrementer ---
  const urlBtn = document.createElement('button');
  urlBtn.textContent = `Push URL (#${urlCount})`;
  urlBtn.style.cssText = `
    width: 100%;
    color: #ffffff;
    background: #238636;
    border: 1px solid rgba(255,255,255,0.2);
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: monospace;
    font-size: 12px;
    font-weight: bold;
    box-sizing: border-box;
  `;
  urlBtn.onmouseover = () => urlBtn.style.background = '#2ea043';
  urlBtn.onmouseout = () => urlBtn.style.background = '#238636';

  urlBtn.onclick = () => {
    const pathId = `/test-page-${urlCount}`;
    history.pushState({ id: urlCount }, `Page ${urlCount}`, pathId);
    window.dispatchEvent(new Event('locationchange'));
    console.log(`[Test Panel] Emitted URL path: ${pathId}`);

    urlCount++;
    urlBtn.textContent = `Push URL (#${urlCount})`;
  };

  // --- Button 2: Google Search Input Injector ---
  const inputBtn = document.createElement('button');
  inputBtn.textContent = `Fill Google Input (#${inputCount})`;
  inputBtn.style.cssText = `
    width: 100%;
    color: #ffffff;
    background: #1f6feb;
    border: 1px solid rgba(255,255,255,0.2);
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: monospace;
    font-size: 12px;
    font-weight: bold;
    box-sizing: border-box;
  `;
  inputBtn.onmouseover = () => inputBtn.style.background = '#388bfd';
  inputBtn.onmouseout = () => inputBtn.style.background = '#1f6feb';

  inputBtn.onclick = () => {
    const searchInput = document.querySelector('textarea[name="q"], input[name="q"]');

    if (searchInput) {
      const queryText = `Test Query #${inputCount}`;
      searchInput.value = queryText;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[Test Panel] Filled Google search bar with: "${queryText}"`);

      inputCount++;
      inputBtn.textContent = `Fill Google Input (#${inputCount})`;
    } else {
      console.warn('[Test Panel] Google search input (name="q") not found on this page.');
    }
  };

  // --- Component 3: Realistic Hover Link (No Jumping) ---
  const linkWrapper = document.createElement('div');
  linkWrapper.style.cssText = `
    text-align: center;
    padding: 4px 0;
    background: rgba(255,255,255,0.03);
    border-radius: 4px;
    border: 1px dashed rgba(0,255,204,0.2);
  `;

  const testLink = document.createElement('a');

  // Set initial realistic URL so Edge's status bar shows it on hover
  let initialUrl = `https://example.com/item-${linkCount}`;
  testLink.href = initialUrl;
  testLink.textContent = `Open Item #${linkCount}`;
  testLink.style.cssText = `
    color: #58a6ff;
    text-decoration: underline;
    font-family: monospace;
    font-size: 11px;
    cursor: pointer;
    word-break: break-all;
  `;

  // Click handler: Stops navigation, logs, and changes both text and hover URL
  testLink.onclick = (e) => {
   // e.preventDefault(); // 🚫 Prevents the browser from actually jumping/navigating

    console.log(`[Test Panel] Clicked hover link pointing to: ${testLink.href}`);

    // Increment and vary for the next click
    linkCount++;
    const nextUrl = `https://example.com/item-${linkCount}?token=test_${linkCount}`;

    testLink.textContent = `Open Item #${linkCount}`;
    testLink.href = nextUrl; // Updates what Edge shows in the status bar on next hover!
  };

  linkWrapper.appendChild(testLink);

  bodyContainer.appendChild(urlBtn);
  bodyContainer.appendChild(inputBtn);
  bodyContainer.appendChild(linkWrapper);
  panel.appendChild(bodyContainer);
  document.body.appendChild(panel);

  // Fold / Unfold Toggle Logic
  let isFolded = false;
  foldBtn.onclick = () => {
    isFolded = !isFolded;
    bodyContainer.style.display = isFolded ? 'none' : 'flex';
    foldBtn.textContent = isFolded ? '[+]' : '[-]';
    panel.style.width = isFolded ? '160px' : '270px';
  };
})();