// ==UserScript==
// @name         Gemini Notebook Active Chat Exporter
// @namespace    https://github.com/
// @version      1.0
// @description  Export the current Gemini Notebook / NotebookLM chat session to a Markdown (.md) file.
// @author       You
// @match        https://notebook.google.com/*
// @match        https://notebooklm.google.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 1. Create Floating UI Button
    function createExportButton() {
        if (document.getElementById('notebook-chat-exporter-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'notebook-chat-exporter-btn';
        btn.innerHTML = '?? Export Chat (.md)';
        btn.style.position = 'fixed';
        btn.style.bottom = '24px';
        btn.style.right = '24px';
        btn.style.zIndex = '999999';
        btn.style.padding = '10px 18px';
        btn.style.backgroundColor = '#1a73e8';
        btn.style.color = '#ffffff';
        btn.style.border = 'none';
        btn.style.borderRadius = '24px';
        btn.style.boxShadow = '0 3px 10px rgba(0,0,0,0.3)';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = '600';
        btn.style.fontFamily = 'Google Sans, Roboto, sans-serif';
        btn.style.transition = 'transform 0.2s, background-color 0.2s';

        btn.onmouseover = () => {
            btn.style.backgroundColor = '#1557b0';
            btn.style.transform = 'scale(1.05)';
        };
        btn.onmouseout = () => {
            btn.style.backgroundColor = '#1a73e8';
            btn.style.transform = 'scale(1.0)';
        };

        btn.addEventListener('click', exportActiveChat);
        document.body.appendChild(btn);
    }

    // 2. Parse Chat DOM and Trigger File Download
    function exportActiveChat() {
        // Query message nodes in the conversation panel
        const messageNodes = document.querySelectorAll('[data-message-author], .chat-message, .conversation-turn, [role="listitem"]');

        let markdownOutput = `# Gemini Notebook Chat Export\n\n`;
        markdownOutput += `*Export Date: ${new Date().toLocaleString()}*\n\n---\n\n`;

        if (messageNodes.length === 0) {
            // Fallback: Grab the main chat body container
            const chatBody = document.querySelector('.chat-panel') || document.body;
            markdownOutput += chatBody.innerText;
        } else {
            let turnCount = 1;
            messageNodes.forEach((node) => {
                // Determine Author / Role
                const isUser = node.getAttribute('data-message-author') === 'user' ||
                               node.classList.contains('user-message') ||
                               node.querySelector('.user-icon') !== null;

                const roleLabel = isUser ? 'User' : 'Gemini Notebook';

                // Clone element to safely remove UI elements (action buttons, citation badges, SVGs)
                const clone = node.cloneNode(true);
                clone.querySelectorAll('button, .copy-btn, .citation-badge-action, svg, [role="button"]').forEach(el => el.remove());

                const textContent = clone.innerText.trim();

                if (textContent.length > 0) {
                    markdownOutput += `### ${turnCount}. ${roleLabel}\n\n${textContent}\n\n---\n\n`;
                    turnCount++;
                }
            });
        }

        // 3. Initiate File Download
        const blob = new Blob([markdownOutput], { type: 'text/markdown;charset=utf-8;' });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `notebook_chat_export_${new Date().toISOString().slice(0, 10)}.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
    }

    // Initialize UI on page load & observe SPA navigation
    window.addEventListener('load', () => setTimeout(createExportButton, 1500));

    const observer = new MutationObserver(() => {
        createExportButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();