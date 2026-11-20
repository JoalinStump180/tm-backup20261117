
// ==UserScript==
// @name         My Global Helpers
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Make my functions available in every tab's console
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Your functions
    function myFunc1(arg='default-jcx') {
        console.log('myFunc1 called with', arg);
        // ...
    }

    function myFunc2() {
        // ...
    }
function textdown(rulesInput) {
  // Robust parser for slot lists and ranges like "1-2,3-4" or "1,3,5-8"
  function parseSlots(rawSlotStr) {
    const allowed = new Set();
    if (!rawSlotStr) return null; // If no slot specified, allow all

    const parts = rawSlotStr.split(",");
    parts.forEach(part => {
      part = part.trim();
      if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            allowed.add(i);
          }
        }
      } else {
        const num = Number(part);
        if (!isNaN(num)) allowed.add(num);
      }
    });
    return allowed;
  }

  // Enhanced helper to split "selector:slots" even when selectors contain special characters or attributes
  function parseField(raw) {
    const s = String(raw || "").trim();

    // Find the last colon that precedes a slot expression (e.g. matching digits, commas, hyphens at the end)
    const match = s.match(/^(.*?):([\d\s,\-]+)$/);
    if (match) {
      return {
        sel: match[1].trim(),
        slots: parseSlots(match[2])
      };
    }
    return { sel: s, slots: null };
  }

  // Helper to fetch all kinds of text from a node
  function getAllKindsOfText(node) {
    if (!node) return "";
    let texts = [];

    if (node.nodeType === Node.TEXT_NODE) {
      const val = (node.nodeValue || "").trim();
      if (val) texts.push(val);
      return texts.join(" / ");
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const inner = (node.innerText || node.textContent || "").trim();
      if (inner) texts.push(inner);

      ["alt", "title", "aria-label", "placeholder", "value"].forEach(attr => {
        const attrVal = node.getAttribute && node.getAttribute(attr);
        if (attrVal && attrVal.trim()) {
          texts.push(`[${attr}: ${attrVal.trim()}]`);
        }
      });
    }

    return texts.join(" | ");
  }

  const cleanInput = rulesInput.replace(/end/gi, "\n");
  const ruleLines = cleanInput.split("\n").map(x => x.trim()).filter(Boolean);
  const out = [];

  ruleLines.forEach(line => {
    const parts = line.split(";").map(x => x.trim()).filter(Boolean);
    if (parts.length < 3) return;

    const scopeSel = parts[0];
    const bField = parseField(parts[1]);
    const cField = parseField(parts[2]);

    const scopes = document.querySelectorAll(scopeSel);

    scopes.forEach((scopeA) => {
      let bNodes = [];
      if (bField.sel === "#text") {
        const tw = document.createTreeWalker(scopeA, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) bNodes.push(tw.currentNode);
      } else {
        bNodes = [...scopeA.querySelectorAll(bField.sel)];
        if (scopeA.matches && scopeA.matches(bField.sel)) bNodes.unshift(scopeA);
      }

      // Filter B nodes using the parsed slot set (supports mixed ranges like 1-2,3-4)
      const selectedBs = bNodes.filter((_, idx) => {
        const slot = idx + 1;
        return bField.slots === null || bField.slots.has(slot);
      });

      selectedBs.forEach((el_b) => {
        const bActualSlot = bNodes.indexOf(el_b) + 1;
        const bText = getAllKindsOfText(el_b);

        const cCandidates = [];

        // 1. DOWNSTREAM FIRST
        if (cField.sel === "#text") {
          const tw = document.createTreeWalker(el_b, NodeFilter.SHOW_TEXT);
          while (tw.nextNode()) cCandidates.push(tw.currentNode);
        } else {
          if (el_b.matches && el_b.matches(cField.sel)) cCandidates.push(el_b);
          const descendants = [...el_b.querySelectorAll(cField.sel)];
          descendants.forEach(d => {
            if (!cCandidates.includes(d)) cCandidates.push(d);
          });
        }

        // 2. UPSTREAM SECOND
        let parent = el_b.parentElement;
        while (parent && scopeA.contains(parent)) {
          if (cField.sel === "#text") {
            const tw = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
            while (tw.nextNode()) {
              if (!cCandidates.includes(tw.currentNode)) cCandidates.push(tw.currentNode);
            }
          } else {
            if (parent.matches && parent.matches(cField.sel) && !cCandidates.includes(parent)) {
              cCandidates.push(parent);
            }
            const matchesInParent = [...parent.querySelectorAll(cField.sel)];
            matchesInParent.forEach(m => {
              if (!cCandidates.includes(m)) cCandidates.push(m);
            });
          }
          if (parent === scopeA) break;
          parent = parent.parentElement;
        }

        // Filter C nodes using the parsed slot set (supports mixed ranges like 1-2,5-6)
        const selectedCs = cCandidates.filter((_, idx) => {
          const slot = idx + 1;
          return cField.slots === null || cField.slots.has(slot);
        });

        selectedCs.forEach((el_c) => {
          const cActualSlot = cCandidates.indexOf(el_c) + 1;
          const cText = getAllKindsOfText(el_c);

          out.push({
            rule: line,
            b_slot: bActualSlot,
            b_text: bText.slice(0, 40),
            c_slot: cActualSlot,
            c_type: el_c.nodeType === Node.TEXT_NODE ? "#text" : el_c.tagName,
            c_text: cText
          });
        });
      });
    });
  });

  console.table(out);
  return out;
}

    function scanComments(textPattern, keyWildcard, format) {
  const textRe = textPattern ? new RegExp(textPattern, "i") : null;
  const star = keyWildcard == null || keyWildcard === "*" || keyWildcard === "";
  const keyRe = star ? null : new RegExp(String(keyWildcard).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*"), "i");
  const mode = format || "tree";
  function keysOf(obj, depth, bag, seen) {
    if (!obj || depth > 4 || typeof obj !== "object" || seen.has(obj)) return;
    seen.add(obj);
    let names;
    try { names = Object.getOwnPropertyNames(obj); } catch { return; }
    for (const k of names) {
      if (k === "parentElement" || k === "parentNode" || k === "ownerDocument") continue;
      if (!keyRe || keyRe.test(k)) bag.push("  ".repeat(depth) + k);
      if (depth < 3 && obj[k] && typeof obj[k] === "object") {
        try { keysOf(obj[k], depth + 1, bag, seen); } catch {}
      }
    }
  }
  const threads = [...document.querySelectorAll("ytd-comment-thread-renderer")]
    .filter(t => !t.parentElement?.closest("ytd-comment-thread-renderer"));
  const hits = [];
  for (const thread of threads) {
    const nodes = [...thread.querySelectorAll("ytd-comment-view-model, ytd-comment-renderer")];
    const matched = nodes.filter(el => !textRe || textRe.test(el.innerText || ""));
    if (!matched.length) continue;
    const bag = [], seen = new Set();
    keysOf(thread.data || thread.__data || thread, 0, bag, seen);
    for (const el of matched) keysOf(el.data || el.__data || el, 0, bag, seen);
    hits.push({
      comments: matched.map(el => ({
        who: ((el.querySelector('a[href*="/@"]')?.getAttribute("href") || "").match(/\/@([^/?#]+)/) || [])[1] || "?",
        text: (el.querySelector("#content-text")?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60)
      })),
      keys: [...new Set(bag)]
    });
  }
  if (mode === "query") { console.log(hits); return hits; }
  const out = hits.map((h, i) =>
    "thread " + i + "\n" +
    h.comments.map((c, n) => (n ? "  └─ @" : "● @") + c.who + "  " + c.text).join("\n") +
    "\n  keys (" + h.keys.length + "):\n" +
    h.keys.map(k => "    " + k).join("\n")
  ).join("\n\n");
  console.log(out || "(no match)");
  return out || "(no match)";
}

    // scanComments(textPattern, keyWildcard, format)
// Locates any element whose own text matches textPattern.
// Several hits are numbered on separate lines.
// keyWildcard: "*parent*" contains, "*" or "" all keys.
// format: "tree" (default) or "query".
function scanComments2(textPattern, keyWildcard, format) {
  const textRe = textPattern ? new RegExp(textPattern, "i") : null;
  const star = keyWildcard == null || keyWildcard === "*" || keyWildcard === "";
  const keyRe = star ? null : new RegExp(
    String(keyWildcard).replace(/[.+?^${}()|[\]\\*]/g, "\\$&").replace(/\\\*/g, ".*"),
    "i"
  );
  const mode = format || "tree";

  function keysOf(obj, depth, bag, seen) {
    if (!obj || depth > 3 || typeof obj !== "object" || seen.has(obj)) return;
    seen.add(obj);
    let names;
    try { names = Object.getOwnPropertyNames(obj); } catch { return; }
    for (const k of names) {
      if (k === "parentElement" || k === "parentNode" || k === "ownerDocument") continue;
      if (!keyRe || keyRe.test(k)) bag.push("  ".repeat(depth) + k);
      if (depth < 2 && obj[k] && typeof obj[k] === "object") {
        try { keysOf(obj[k], depth + 1, bag, seen); } catch {}
      }
    }
  }

  const all = [...document.querySelectorAll("body *")];
  const raw = all.filter(el => {
    if (el.closest("#vul-debug-overlay")) return false;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(" ");
    const blob = (own || el.innerText || "").replace(/\s+/g, " ").trim();
    if (!blob) return false;
    return textRe ? textRe.test(blob) : false;
  });
  const hits = raw.filter(el => !raw.some(other => other !== el && el.contains(other)));

  const rows = hits.map((el, i) => {
    const thread = el.closest("ytd-comment-thread-renderer");
    const host = thread || el.closest("ytd-comment-view-model, ytd-comment-renderer") || el;
    const bag = [], seen = new Set();
    keysOf(host.data || host.__data || host, 0, bag, seen);
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return {
      n: i + 1,
      tag: el.tagName.toLowerCase(),
      father: thread ? "ytd-comment-thread-renderer" : host.tagName.toLowerCase(),
      text,
      keys: [...new Set(bag)]
    };
  });

  if (mode === "query") { console.log(rows); return rows; }
  const out = rows.map(r =>
    r.n + ". <" + r.tag + ">  father=" + r.father + "\n" +
    "   " + r.text + "\n" +
    "   keys (" + r.keys.length + "):\n" +
    r.keys.map(k => "     " + k).join("\n")
  ).join("\n\n");
  console.log(out || "(no match)");
  return out || "(no match)";
}


function findStrings2(searchString, caseSensitive = false, quiet   = true) {
    if (!searchString) {
        console.warn('No search string provided.');
        return null;
    }
    const results = [];

    function getDomPath(node) {
        const path = [];
        let currentNode = node;
        while (currentNode && currentNode !== document) {
            let selector = currentNode.nodeName.toLowerCase();
            if (currentNode.parentNode) {
                const siblings = Array.from(currentNode.parentNode.childNodes)
                    .filter(n => n.nodeName === currentNode.nodeName && n.nodeType === currentNode.nodeType);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(currentNode) + 1;
                    selector += `:nth-child(${index})`;
                }
            }
            if (currentNode.id) {
                selector += `#${currentNode.id}`;
            } else if (currentNode.className && typeof currentNode.className === 'string') {
                const classes = currentNode.className.trim().split(/\s+/).join('.');
                if (classes) selector += `.${classes}`;
            }
            path.unshift(selector);
            currentNode = currentNode.parentNode;
        }
        return path.join(' > ');
    }

    const checkIncludes = caseSensitive
        ? (text) => text.includes(searchString)
        : (text) => text.toLowerCase().includes(searchString.toLowerCase());

    function traverseDOM(node) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) {
            const text = node.textContent;
            if (text && checkIncludes(text)) {
                const trimmed = text.trim();
                if (trimmed) {
                    const match = {
                        type: 'text',
                        content: trimmed,
                        fullContent: text,
                        domPath: getDomPath(node)
                    };
                    results.push(match);
                    if (!quiet) console.log(match);
                }
            }
        }
        if (node.attributes) {
            Array.from(node.attributes).forEach(attr => {
                if (attr.value && checkIncludes(attr.value)) {
                    const match = {
                        type: 'attribute',
                        attribute: attr.name,
                        content: attr.value,
                        domPath: `${getDomPath(node)}[@${attr.name}]`
                    };
                    results.push(match);
                   if (!quiet)  console.log(match);
                }
            });
        }
        node.childNodes.forEach(child => traverseDOM(child));
    }

    traverseDOM(document.body);
    return results.length ? results : null;   // hit → array; miss → null
}



function findStrings(searchString, caseSensitive = false) {
    if (!searchString) {
        console.warn('No search string provided.');
        return;
    }

    // Helper function to get the full DOM path of a node
    function getDomPath(node) {
        const path = [];
        let currentNode = node;

        while (currentNode && currentNode !== document) {
            let selector = currentNode.nodeName.toLowerCase();

            // Add index if node has siblings of the same type
            if (currentNode.parentNode) {
                const siblings = Array.from(currentNode.parentNode.childNodes)
                    .filter(n => n.nodeName === currentNode.nodeName && n.nodeType === currentNode.nodeType);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(currentNode) + 1;
                    selector += `:nth-child(${index})`;
                }
            }

            // Add ID or classes if available
            if (currentNode.id) {
                selector += `#${currentNode.id}`;
            } else if (currentNode.className && typeof currentNode.className === 'string') {
                const classes = currentNode.className.trim().split(/\s+/).join('.');
                if (classes) {
                    selector += `.${classes}`;
                }
            }

            path.unshift(selector);
            currentNode = currentNode.parentNode;
        }

        return path.join(' > ');
    }

    // Check function based on case sensitivity
    const checkIncludes = caseSensitive
        ? (text) => text.includes(searchString)
        : (text) => text.toLowerCase().includes(searchString.toLowerCase());

    // Recursive function to traverse DOM
    function traverseDOM(node) {
        if ((node.nodeType === Node.TEXT_NODE)||(node.nodeType === Node.ELEMENT_NODE)) {
            const text = node.textContent;
            if (text && checkIncludes(text)) {
                // Optional: trim and show only relevant part
                const trimmed = text.trim();
                if (trimmed) {
                    console.log({
                        type: 'text',
                        content: trimmed,
                        fullContent: text, // original with whitespace
                        domPath: getDomPath(node)
                    });
                }
            }
        } // else if (node.nodeType === Node.ELEMENT_NODE) {
            // Skip <style> and <script> to avoid noise
            //if (node.nodeName === 'STYLE' || node.nodeName === 'SCRIPT') {
          //  if (node.nodeName === 'STYLE'  ) {
             //   return;
         //   }

            // Check attributes
            if (node.attributes) {
                Array.from(node.attributes).forEach(attr => {
                    if (attr.value && checkIncludes(attr.value)) {
                        console.log({
                            type: 'attribute',
                            attribute: attr.name,
                            content: attr.value,
                            domPath: `${getDomPath(node)}[@${attr.name}]`
                        });
                    }
                });
            }

            // Recurse into children
            node.childNodes.forEach(child => traverseDOM(child));
        }
    traverseDOM(document.body);
}




function createSecretToggle(options = {}) {
    const {
        secret = 'yttitle',
        getButtonText = () => 'Logs',
        onShow = () => {},
        onHide = () => {},
        left = '8px',
        top = '8px'
    } = options;

    let keyBuffer = '';
    let button = null;
    let lastKey = '';
    let lastKeyTime = 0;
    const DEBOUNCE_MS = 40;

    function isTypingTarget(el) {
        if (!el || el === document || el === window) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' ||
               el.isContentEditable || el.getAttribute?.('contenteditable') === 'true';
    }

    function createButton() {
        if (button) return;
        button = document.createElement('button');
        button.textContent = getButtonText();
        button.style.cssText = `
            position:fixed !important;
            left:${left} !important;
            top:${top} !important;
            z-index:2147483647 !important;
            padding:6px 12px !important;
            background:#111 !important;
            color:#fff !important;
            border:none !important;
            border-radius:4px !important;
            font:12px/1.2 sans-serif !important;
            cursor:pointer !important;
        `;
        (document.body || document.documentElement).appendChild(button);
        onShow(button);
    }

    function removeButton() {
        if (!button) return;
        button.remove();
        button = null;
        onHide();
    }

    function onKey(e) {
        const key = (e.key || '').toLowerCase();
        if (key.length !== 1) return;

        const now = Date.now();

        // ---- debounce ----
        if (key === lastKey && (now - lastKeyTime) < DEBOUNCE_MS) {
            return;   // ignore duplicate keydown
        }
        lastKey = key;
        lastKeyTime = now;
        // ------------------

        if (isTypingTarget(e.target)) {
            keyBuffer = '';
            return;
        }

        keyBuffer = (keyBuffer + key).slice(-30);

        if (keyBuffer.includes(secret.toLowerCase())) {
            button ? removeButton() : createButton();
            keyBuffer = '';
        }
    }

    document.addEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);

    return { show: createButton, hide: removeButton };
}






    // Put them on the page global scope
    const funcs = { createSecretToggle, myFunc1, myFunc2,scanComments ,scanComments2 ,findStrings ,findStrings2, textdown};

    for (const [name, fn] of Object.entries(funcs)) {
        if (!globalThis[name]) {
            globalThis[name] = fn;
        }
    }

    // Safer alternative: put everything under one namespace
    globalThis.myTools = funcs;

    // Even safer (almost collision-proof)
    globalThis[Symbol.for('myTools')] = funcs;
})();