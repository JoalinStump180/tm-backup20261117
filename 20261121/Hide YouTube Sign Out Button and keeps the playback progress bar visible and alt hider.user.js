// ==UserScript==
// @name         Hide YouTube Sign Out Button  and keeps the playback progress bar visible and alt hider
// @namespace    https://youtube.com/
// @version      1.1
// @description  Hides the Sign Out button and keeps the playback progress bar visible
// @author       Blumsie
// @match        https://www.youtube.com/*
// @grant        none
// @downloadURL https://update.greasyfork.org/scripts/535007/Hide%20YouTube%20Sign%20Out%20Button.user.js
// @updateURL https://update.greasyfork.org/scripts/535007/Hide%20YouTube%20Sign%20Out%20Button.meta.js
// ==/UserScript==

  (function() {
    'use strict';
    const hideLogout = () => {
        const logoutItems = Array.from(document.querySelectorAll('ytd-compact-link-renderer, ytd-menu-service-item-renderer'))
            .filter(el => {
                const data = el.__data || el.data || {};
                if (data.serviceEndpoint && data.serviceEndpoint.logoutEndpoint) return true;
                const urlMatch = el.innerHTML.includes('/logout') || el.innerHTML.includes('LogoutEndpoint');
                return urlMatch;
            });
        logoutItems.forEach(el => {
            el.style.display = 'none';
        });
    };
    const observer = new MutationObserver(hideLogout);
    observer.observe(document.body, { childList: true, subtree: true });
    hideLogout();
})();

// youtube video progress bar hide ver3
  (function () {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        .ytp-chrome-bottom,
        .ytp-chrome-controls,
        .ytp-progress-bar-container,
        .ytp-gradient-bottom {
            opacity: 1 !important;
            display: block !important;
            visibility: visible !important;
            transition: none !important;
            pointer-events: auto !important;
        }
        .ytp-autohide .ytp-chrome-bottom,
        .ytp-autohide-active .ytp-chrome-bottom {
            opacity: 1 !important;
        }

        /* Instant hide when Alt is pressed */
        .html5-video-player.force-hide-controls .ytp-chrome-bottom,
        .html5-video-player.force-hide-controls .ytp-gradient-bottom {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }
    `;
    document.documentElement.appendChild(style);

    const getPlayer = () => document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    // Track Alt key instantly and prevent browser menu focus trap
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Alt') {
            e.preventDefault(); // Prevents browser from stealing focus
            const p = getPlayer();
            if (p) p.classList.add('force-hide-controls');
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') {
            const p = getPlayer();
            if (p) p.classList.remove('force-hide-controls');
        }
    });

    window.addEventListener('blur', () => {
        const p = getPlayer();
        if (p) p.classList.remove('force-hide-controls');
    });

    const pad = n => String(n).padStart(2, '0');
    const fmt = t => {
        if (!isFinite(t) || t < 0) return '0:00';
        t = Math.floor(t);
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const s = t % 60;
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    };

    setInterval(() => {
        const p = getPlayer();
        if (!p) return;

        if (p.classList.contains('force-hide-controls')) return;

        p.classList.remove('ytp-autohide', 'ytp-autohide-active');

        const video = p.querySelector('video');
        if (!video || !video.duration) return;

        const cur = p.querySelector('.ytp-time-current');
        const dur = p.querySelector('.ytp-time-duration');
        if (cur) cur.textContent = fmt(video.currentTime);
        if (dur) dur.textContent = fmt(video.duration);

        const played = p.querySelector('.ytp-play-progress');
        if (played) played.style.transform = `scaleX(${video.currentTime / video.duration})`;

        if (video.buffered.length) {
            const loaded = p.querySelector('.ytp-load-progress');
            if (loaded) {
                const end = video.buffered.end(video.buffered.length - 1);
                loaded.style.transform = `scaleX(${Math.min(end / video.duration, 1)})`;
            }
        }
    }, 250);
})();
// youtube video progress bar hide ver2
if (0)
  if (0) (function () {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        .ytp-chrome-bottom,
        .ytp-chrome-controls,
        .ytp-progress-bar-container,
        .ytp-gradient-bottom {
            opacity: 1 !important;
            display: block !important;
            visibility: visible !important;
            transition: none !important;
            pointer-events: auto !important;
        }
        .ytp-autohide .ytp-chrome-bottom,
        .ytp-autohide-active .ytp-chrome-bottom {
            opacity: 1 !important;
        }

        /* Instant hide when Alt is pressed */
        .html5-video-player.force-hide-controls .ytp-chrome-bottom,
        .html5-video-player.force-hide-controls .ytp-gradient-bottom {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }
    `;
    document.documentElement.appendChild(style);

    // Helper to grab the player element quickly
    const getPlayer = () => document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    // Instant toggle on keydown/keyup without waiting for the interval
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Alt') {
            const p = getPlayer();
            if (p) p.classList.add('force-hide-controls');
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') {
            const p = getPlayer();
            if (p) p.classList.remove('force-hide-controls');
        }
    });

    window.addEventListener('blur', () => {
        const p = getPlayer();
        if (p) p.classList.remove('force-hide-controls');
    });

    const pad = n => String(n).padStart(2, '0');
    const fmt = t => {
        if (!isFinite(t) || t < 0) return '0:00';
        t = Math.floor(t);
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const s = t % 60;
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    };

    // Interval now only handles the progress bar & time updates
    setInterval(() => {
        const p = getPlayer();
        if (!p) return;

        // Skip updating UI if hidden
        if (p.classList.contains('force-hide-controls')) return;

        p.classList.remove('ytp-autohide', 'ytp-autohide-active');

        const video = p.querySelector('video');
        if (!video || !video.duration) return;

        const cur = p.querySelector('.ytp-time-current');
        const dur = p.querySelector('.ytp-time-duration');
        if (cur) cur.textContent = fmt(video.currentTime);
        if (dur) dur.textContent = fmt(video.duration);

        const played = p.querySelector('.ytp-play-progress');
        if (played) played.style.transform = `scaleX(${video.currentTime / video.duration})`;

        if (video.buffered.length) {
            const loaded = p.querySelector('.ytp-load-progress');
            if (loaded) {
                const end = video.buffered.end(video.buffered.length - 1);
                loaded.style.transform = `scaleX(${Math.min(end / video.duration, 1)})`;
            }
        }
    }, 250);
})();

















