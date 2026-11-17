// ==UserScript==
// @name         Viewport box capture POC
// @namespace    viewport-capture-poc
// @version      0.2.0
// @description  Slow-scrolling 8-line window, capture a box inside a named div, download a zip.
// @match        *://*/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.__viewportCapturePoc) return;
  window.__viewportCapturePoc = true;

  const LINE_H = 28;
  const VISIBLE = 8;
  const TOTAL = 90;

  const stage = document.createElement('div');
  stage.id = 'vpc-reader';
  stage.innerHTML = '<div id="vpc-reader-inner"></div>';
  const inner = stage.firstChild;
  for (let i = 1; i <= TOTAL; i++) {
    const line = document.createElement('div');
    line.className = 'vpc-line';
    line.textContent = 'line ' + i + '  —  sample text for the scrolling window';
    inner.appendChild(line);
  }

  const stageStyle = document.createElement('style');
  stageStyle.textContent = [
    '#vpc-reader{position:fixed;left:16px;top:16px;z-index:2147483645;',
    'width:420px;height:' + (LINE_H * VISIBLE) + 'px;overflow:hidden;',
    'background:#1a1a1a;color:#c8c8c8;border:1px solid #444;',
    'font:16px/' + LINE_H + 'px sans-serif}',
    '#vpc-reader-inner{will-change:transform}',
    '.vpc-line{height:' + LINE_H + 'px;padding:0 12px;white-space:nowrap;overflow:hidden}'
  ].join('');
  document.documentElement.appendChild(stageStyle);
  document.documentElement.appendChild(stage);

  let offset = 0;
  const maxOffset = (TOTAL - VISIBLE) * LINE_H;
  function tick() {
    offset += 0.35;
    if (offset > maxOffset) offset = 0;
    inner.style.transform = 'translateY(' + (-offset) + 'px)';
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const panel = document.createElement('div');
  panel.id = 'vpc-panel';
  panel.innerHTML = [
    '<div id="vpc-title">Div box capture</div>',
    '<label>Div name <input id="vpc-name" type="text" value="vpc-reader"></label>',
    '<label>Repeat <input id="vpc-repeat" type="number" min="1" max="50" value="2"></label>',
    '<label>Wait sec <input id="vpc-wait" type="number" min="0" max="60" step="0.5" value="5"></label>',
    '<label>Box x <input id="vpc-x" type="number" value="0"></label>',
    '<label>Box y <input id="vpc-y" type="number" value="0"></label>',
    '<label>Box w <input id="vpc-w" type="number" min="0" value="0"></label>',
    '<label>Box h <input id="vpc-h" type="number" min="0" value="0"></label>',
    '<div id="vpc-actions">',
    '  <button id="vpc-start" type="button">Start</button>',
    '  <button id="vpc-stop" type="button" disabled>Stop</button>',
    '</div>',
    '<div id="vpc-status">idle</div>'
  ].join('');

  const style = document.createElement('style');
  style.textContent = [
    '#vpc-panel{position:fixed;top:12px;right:12px;z-index:2147483646;',
    'background:#111;color:#eee;font:12px/1.3 sans-serif;padding:10px;',
    'border:1px solid #444;border-radius:8px;width:230px;box-shadow:0 8px 24px #0008}',
    '#vpc-title{font-weight:700;margin-bottom:8px}',
    '#vpc-panel label{display:flex;justify-content:space-between;gap:8px;margin:4px 0;align-items:center}',
    '#vpc-panel input{width:110px;background:#222;color:#eee;border:1px solid #555;border-radius:4px;padding:3px 6px}',
    '#vpc-actions{display:flex;gap:6px;margin-top:8px}',
    '#vpc-panel button{flex:1;padding:6px 8px;border:0;border-radius:4px;cursor:pointer}',
    '#vpc-start{background:#ffe08a;color:#111}',
    '#vpc-stop{background:#444;color:#eee}',
    '#vpc-status{margin-top:8px;color:#bbb;min-height:2.6em;white-space:pre-wrap}'
  ].join('');
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(panel);

  const $ = (id) => document.getElementById(id);
  const status = (text) => { $('vpc-status').textContent = text; };

  function num(id, fallback) {
    const n = Number($(id).value);
    return Number.isFinite(n) ? n : fallback;
  }

  function findDiv() {
    const name = $('vpc-name').value.trim();
    if (!name) return null;
    return document.getElementById(name) || document.querySelector(name);
  }

  function syncSize() {
    const el = findDiv();
    if (!el) return;
    $('vpc-w').value = String(el.clientWidth);
    $('vpc-h').value = String(el.clientHeight);
  }
  syncSize();

  function box(el) {
    const x = Math.max(0, num('vpc-x', 0));
    const y = Math.max(0, num('vpc-y', 0));
    const wIn = num('vpc-w', 0);
    const hIn = num('vpc-h', 0);
    const w = wIn > 0 ? wIn : el.clientWidth;
    const h = hIn > 0 ? hIn : el.clientHeight;
    return {
      x: Math.min(x, Math.max(0, el.clientWidth - 1)),
      y: Math.min(y, Math.max(0, el.clientHeight - 1)),
      w: Math.max(1, Math.min(w, el.clientWidth)),
      h: Math.max(1, Math.min(h, el.clientHeight))
    };
  }

  function sleep(ms, token) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      token.cancel = () => {
        clearTimeout(t);
        reject(new Error('stopped'));
      };
    });
  }

  async function grab(el, region) {
    const canvas = await html2canvas(el, {
      x: region.x,
      y: region.y,
      width: region.w,
      height: region.h,
      scale: 1,
      useCORS: true,
      backgroundColor: '#1a1a1a',
      ignoreElements: (node) => node.id === 'vpc-panel'
    });
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  let running = null;

  async function run() {
    const token = { cancel: null };
    running = token;
    $('vpc-start').disabled = true;
    $('vpc-stop').disabled = false;

    try {
      const el = findDiv();
      if (!el) throw new Error('div not found');
      const times = Math.max(1, Math.min(50, Math.floor(num('vpc-repeat', 2))));
      const waitMs = Math.max(0, num('vpc-wait', 5)) * 1000;
      const region = box(el);
      const zip = new JSZip();
      const folder = zip.folder('frames');

      for (let i = 0; i < times; i++) {
        status('shot ' + (i + 1) + '/' + times + '\nwait ' + (waitMs / 1000) + 's');
        await sleep(waitMs, token);
        status('shot ' + (i + 1) + '/' + times + '\ncapturing #' + el.id);
        const png = await grab(el, region);
        if (!png) throw new Error('canvas toBlob failed');
        folder.file('shot-' + String(i + 1).padStart(2, '0') + '.png', png);
      }

      status('zipping');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'div-shots.zip');
      status('done\n' + times + ' png in div-shots.zip');
    } catch (err) {
      status(err && err.message ? err.message : String(err));
    } finally {
      running = null;
      $('vpc-start').disabled = false;
      $('vpc-stop').disabled = true;
    }
  }

  $('vpc-name').addEventListener('change', syncSize);
  $('vpc-start').addEventListener('click', () => {
    if (!running) run();
  });
  $('vpc-stop').addEventListener('click', () => {
    if (running && running.cancel) running.cancel();
  });
})();
