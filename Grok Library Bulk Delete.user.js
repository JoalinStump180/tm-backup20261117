// ==UserScript==
// @name         Grok Library Bulk Delete
// @namespace    https://greasyfork.org/users/yourname
// @version      1.2
// @description  Bulk-delete on grok.com/library (targets aria-label="Item actions" + text "delete")
// @author       You
// @match        https://*/*
// @match        https://grok.com/library*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DELAY_BETWEEN_ITEMS = 1400;
  const DELAY_AFTER_HOVER   = 400;
  const DELAY_AFTER_MENU    = 500;
  const DELAY_AFTER_DELETE  = 700;

  let running = false;
  let stopRequested = false;

  const btn = document.createElement('button');
  btn.textContent = '▶ Bulk Delete';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: 99999,
    padding: '12px 18px', fontSize: '15px', fontWeight: '600',
    background: '#111', color: '#fff', border: 'none',
    borderRadius: '10px', cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,.3)'
  });
  document.body.appendChild(btn);

  const status = document.createElement('div');
 if (0) Object.assign(status.style, {
    position: 'fixed', bottom: '70px', right: '24px', zIndex: 99999,
    padding: '8px 12px', background: 'rgba(0,0,0,.85)', color: '#fff',
    borderRadius: '8px', fontSize: '13px', maxWidth: '340px',
    wordBreak: 'break-word'
  });



     Object.assign(btn.style, {
  position: 'fixed',
  bottom: '100px',     // raised
  right: '24px',
  zIndex: 99999,
  padding: '12px 18px',
  fontSize: '15px',
  fontWeight: '600',
  background: '#111',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,.3)'
});
  status.textContent = 'Ready';
  document.body.appendChild(status);

  const setStatus = (t) => { status.textContent = t; console.log('[BulkDelete]', t); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function getItemName(tile) {
    const img = tile.querySelector('img');
    if (img?.alt) return img.alt.slice(0, 90);
    const title = tile.querySelector('[title]');
    if (title?.title) return title.title.slice(0, 90);
    return (tile.innerText || '').trim().split('\n')[0].slice(0, 90) || 'unnamed';
  }

  function forceHover(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
  }

  async function processOne(tile) {
    const name = getItemName(tile);
    setStatus(`Hovering: ${name}`);

    forceHover(tile);
    await sleep(DELAY_AFTER_HOVER);

    // Precise: aria-label="Item actions"
    //const menuBtn = tile.querySelector('button[aria-label="Item actions"]');
      //more aggressive.
         const menuBtn = document.querySelector('button[aria-label="Item actions"]') ||
                [...document.querySelectorAll('button')].find(b =>
                  (b.getAttribute('aria-label') || '').toLowerCase().includes('item action')
                );

    if (!menuBtn) {
      setStatus(`No "Item actions" button for: ${name}`);
      return false;
    }

    menuBtn.click();
    await sleep(DELAY_AFTER_MENU);

    // Precise: text is "delete" (aria-label empty)
    const deleteBtn = [...document.querySelectorAll('button, [role="menuitem"], div')]
      .find(el => el.textContent.trim().toLowerCase() === 'delete');

    if (!deleteBtn) {
      setStatus(`No "delete" text found for: ${name}`);
      document.body.click();
      return false;
    }

    deleteBtn.click();
    await sleep(DELAY_AFTER_DELETE);

    // Confirm dialog (still matches by text)
    const confirmBtn = [...document.querySelectorAll('button')]
      .find(b => /delete|confirm|yes/i.test(b.textContent.trim()));
    if (confirmBtn && confirmBtn !== deleteBtn) {
      confirmBtn.click();
      await sleep(DELAY_AFTER_DELETE);
    }

    setStatus(`Deleted: ${name}`);
    return true;
  }

  async function run() {
    running = true;
    stopRequested = false;
    btn.textContent = '■ Stop';
    btn.style.background = '#c0392b';

    while (!stopRequested) {
      const tiles = [...document.querySelectorAll(
        '[data-library-item-id], [class*="library-item"], [class*="asset"], article, [role="listitem"]'
      )].filter(el => el.querySelector('img, video') || el.offsetHeight > 50);

      if (tiles.length === 0) {
        setStatus('No more items visible. Scroll or stop.');
        break;
      }

      const tile = tiles[0];
      const ok = await processOne(tile);
      if (!ok) tile.style.outline = '2px solid orange';

      if (stopRequested) break;
      await sleep(DELAY_BETWEEN_ITEMS);
      window.scrollBy(0, 180);
    }

    running = false;
    btn.textContent = '▶ Bulk Delete';
    btn.style.background = '#111';
    setStatus(stopRequested ? 'Stopped' : 'Done (or no more items)');
  }

  btn.onclick = () => {
    if (running) {
      stopRequested = true;
      setStatus('Stopping…');
    } else {
      run();
    }
  };

  setStatus('Button ready. Click to start.');
})();