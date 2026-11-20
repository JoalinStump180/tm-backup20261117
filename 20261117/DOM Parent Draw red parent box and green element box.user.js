
// ==UserScript==
// @name         DOM Parent Draw red parent box and green element box
// @namespace    local.debug
// @version      1.0
// @description  Draw red parent box and green element box under mouse
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const redBox = document.createElement("div");
    const greenBox = document.createElement("div");

    function setupBox(box, color) {
        Object.assign(box.style, {
            position: "fixed",
            boxSizing: "border-box",
            border: `2px solid ${color}`,
            pointerEvents: "none",
            zIndex: "2147483647",
            display: "none"
        });
        document.documentElement.appendChild(box);
    }

    setupBox(redBox, "red");
    setupBox(greenBox, "lime");

    function drawBox(box, el) {
        if (!el || el === document.documentElement ||
            el === document.body) {
            box.style.display = "none";
            return;
        }

        const r = el.getBoundingClientRect();

        Object.assign(box.style, {
            display: "block",
            left: r.left + "px",
            top: r.top + "px",
            width: r.width + "px",
            height: r.height + "px"
        });
    }

    document.addEventListener("mousemove", function (e) {
        const target = document.elementFromPoint(e.clientX, e.clientY);

        if (!target || target === redBox || target === greenBox) return;

        drawBox(greenBox, target);
        drawBox(redBox, target.parentElement);
    }, true);

})();
