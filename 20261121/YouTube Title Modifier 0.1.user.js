// ==UserScript==
// @name         YouTube Title Modifier  0.1
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Modify YouTube page title to include uploader's name
// @author       Your Name
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    //  alert("youtube title modifier  Script is running!");

    var myaccountprefix
    var lastprefix
    myaccountprefix = "myaccount - ";
    // alert(` myaccountprefix in 0 :  ${myaccountprefix}`);
    function refreshPrefix() {
          lastprefix=myaccountprefix
        if (findStrings2("martin guptile") || findStrings2("guptilemartin")) {
            myaccountprefix = "martin - ";
        }

        if (findStrings2("nathan lowry")||findStrings2("archibaldflowers"))   {
            myaccountprefix = "archi - "}
        if (findStrings2("kuraki mai")||findStrings2("holptbjdd")||findStrings2("nile farcell"))  {

            myaccountprefix = "hol - "}
        // alert(` myaccountprefix in 3 :  ${myaccountprefix}`);





    }



    function getShortsUploader() {
        // 1. Target the actual active Shorts container
        // YouTube's active short usually has this specific internal container class
        const activeShort = document.querySelector('ytd-shorts-player[is-active]');

        // If we can't find the active container, look for the current video player
        const playerContainer = activeShort || document.querySelector('#shorts-player');

        if (!playerContainer) return null;

        // 2. Find the uploader handle specifically within the active player's context
        // Instead of querying the whole document, query only within the active player/page
        const handleElement = document.querySelector('ytd-shorts-video-renderer[is-active] a[href*="/@"]')
        || document.querySelector('a[href*="/@"]');

        if (handleElement) {
            const href = handleElement.getAttribute('href');
            const match = href.match(/(@[a-zA-Z0-9._-]+)/);
            if (match) {
                console.log("%c ? Active Uploader: " + match[0], "color: #00ff00; font-weight: bold;");
                return match[0];
            }
        }

        return null;
    }

    function getShortsUploader2() {
        // 1. Try to find the Shorts-style uploader link first
        const shortsLink = document.querySelector('a[href*="/@"][href*="/shorts"]');

        // 2. Fallback: Find the channel link on a regular /watch page
        // Look for links that start with /@ or /channel/ inside the owner section
        const watchPageLink = document.querySelector('#owner #channel-name a[href^="/@"], #owner #channel-name a[href^="/channel/"]');

        const targetLink = shortsLink || watchPageLink;

        if (!targetLink) {
            console.warn("Could not identify the channel/uploader.");
            return null;
        }

        const href = targetLink.getAttribute('href');

        // Extract handle (@handle) or channel ID
        //const match = href.match(/(@[a-zA-Z0-9._-]+|\/channel\/[a-zA-Z0-9_-]+)/);
        const match = href.match(/(@[^ ]+|\/channel\/[a-zA-Z0-9_-]+)/);
        if (match) {
            const identifier = match[0];
            console.log("%c ?? Active Channel: " + identifier, "color: #00ff00; font-weight: bold;");
            return identifier;
        }

        return null;
    }

    function getShortsUploader3() {
        // 1. Get all links containing the uploader handle and /shorts suffix
        const allShortsLinks = Array.from(document.querySelectorAll('a[href*="/@"][href*="/shorts"]'));

        if (allShortsLinks.length === 0) {
            console.warn("No uploader links found. Ensure you are on the Shorts feed.");
            return null;
        }

        const viewportCenter = window.innerHeight / 2;
        let closestLink = null;
        let minDistance = Infinity;

        // 2. Identify the link closest to the center of the screen
        allShortsLinks.forEach(link => {
            const rect = link.getBoundingClientRect();
            const linkCenter = rect.top + (rect.height / 2);
            const distance = Math.abs(viewportCenter - linkCenter);

            if (distance < minDistance) {
                minDistance = distance;
                closestLink = link;
            }
        });

        if (closestLink) {
            const href = closestLink.getAttribute('href');
            // Regex extracts the @handle (stopping before any / or ?)
            const match = href.match(/(@[a-zA-Z0-9._-]+)/);

            if (match) {
                const handle = match[0];
                console.log("%c ? Current Uploader: " + handle, "color: #00ff00; font-weight: bold;");
                return handle;
            }
        }

        console.error("Could not determine the active uploader.");
        return null;
    };


    function sanitizeWindowsFilename(filename) {
        // Regex matches: < > : " / \ | ? * and ASCII control characters
        const reservedChars = /[<>:&"/\\|?*\x00-\x1f]/g;
        //return filename.replace(reservedChars, '_');
        //return filename;
        return filename;
    }


    Object.defineProperty(String.prototype, 'sanitizeWindowsFilename', {
        value: function() {
            const reservedChars = /[<>:&"\/\\|?*\x00-\x1f]/g;
            //return this.replace(reservedChars, '_').replace(/[\s.]+$/, '');
            return this;
        },
        enumerable: false, // This hides it from loops
        writable: true,
        configurable: true
    });
    //var title1=document.querySelector('yt-dynamic-text-view-model.ytPageHeaderViewModelTitle:nth-child(2) > h1:nth-child(1)').textContent.trim();
    // var title1 = document.querySelector('title').textContent.trim();

    function getTitle2() {
        // 1. Try the standard /watch selector
        const watchTitle = document.querySelector('h1.ytd-watch-metadata');
        if (watchTitle) return watchTitle.textContent.trim();

        // 2. Try the Shorts selector (you may need to inspect the specific class/ID on your version)
        // Note: Shorts UI is very dynamic; you may need to use a broader selector
        const shortsTitle = document.querySelector('#overlay ytd-reel-video-renderer h2, #title.ytd-shorts-video-renderer');
        if (shortsTitle) return shortsTitle.textContent.trim();

        // 3. Last resort: The browser tab title
        return document.title.replace(" - YouTube", "");
    }

    function getTitle() {
        // 1. Try the standard /watch selector
        const watchTitle = document.querySelector('h1.ytd-watch-metadata');
        if (watchTitle) return watchTitle.textContent.trim();

        // 2. Try the Shorts selector (you may need to inspect the specific class/ID on your version)
        // Note: Shorts UI is very dynamic; you may need to use a broader selector
        const shortsTitle = document.querySelector('yt-dynamic-text-view-model.ytPageHeaderViewModelTitle:nth-child(2) > h1:nth-child(1)')
        if (shortsTitle) return shortsTitle.textContent.trim();

        // 3. Last resort: The browser tab title
        return document.title.replace(" - YouTube", "");
    }


    function updateTitle() {

        const currentURL = window.location.href;
        var date = new Date();
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        // Months are 0-indexed, so we add 1
        var day = String(date.getDate()).padStart(2, '0');
        var formattedDate = `${year}${month}${day}`;
        let currentDate = new Date();
        var formattedTime = 'time'+currentDate.getHours().toString().padStart(2, '0') +
            currentDate.getMinutes().toString().padStart(2, '0') +
            currentDate.getSeconds().toString().padStart(2, '0');


        var titleElement = document.querySelector('h1.title.ytd-video-primary-info-renderer');
        var uploaderElement = document.querySelector('h3#title.style-scope.ytd-video-description-infocards-section-renderer');

        var title3 = document.querySelector('title')?.textContent.trim()??"";




refreshPrefix();
          document.title = document.title.replaceAll(lastprefix, myaccountprefix);


        if (window.location.href.includes('youtube.com'))  {
            if (!document.title.includes(myaccountprefix)) {


                if (window.location.href.includes('/watch')||window.location.href.includes('youtube.com/short')) {

                    //var title3 = document.title.textContent.trim();
                    //var title1 = document.querySelector('title')?.textContent.trim()??"";
                    // var myaccountprefix=(findStrings2('martin guptile') || findStrings2('guptilemartin') || findStrings2('cccccc')) && 'martin - '
                    var title1 = document.querySelector('h1.ytd-watch-metadata')?.textContent.trim()??""
                    var title2 = document.querySelector('yt-dynamic-text-view-model.ytPageHeaderViewModelTitle:nth-child(2) > h1:nth-child(1)')?.textContent.trim()??""
                    var uploader1 = decodeURI(uploaderElement?.textContent.slice(0,25))??"";

                    var uploader2 =decodeURI(getShortsUploader2())??"";

                    //TODO: add an inner iteration for , say  temptitle ; when temptitle 's val does not changed ,do  document.title=temptitle

                    if (window.location.href.includes('/watch'))   document.title =  `${uploader1}${uploader2} ---- ${myaccountprefix}${title1}[${formattedDate}] ${formattedTime}  ${currentURL} `.sanitizeWindowsFilename();
                    if (window.location.href.includes('youtube.com/short')  )   document.title =  `${uploader2} ---- ${title2}[${formattedDate}] ${formattedTime}  ${currentURL} `.sanitizeWindowsFilename();


                } else if (window.location.href.includes('www.youtube.com/@')||window.location.href.includes('www.youtube.com/channel')  ) {
                    if (!document.title.includes('playlist') ) {

                        if (!document.title.includes('ytc_usermainpage'))   document.title = document.querySelector('title').textContent + ` ytc_usermainpage ${formattedDate} ${formattedTime}  ${currentURL} `.sanitizeWindowsFilename();

                    }
                } else {
                    // Reset to default title when it's not a video page
                    title1 = document.querySelector('title').textContent;
                    document.title =`${title3} ${myaccountprefix}${formattedDate} ${formattedTime} ${currentURL}`.sanitizeWindowsFilename();
                }

            }

                                                           }

        if (1)  if (!window.location.href.includes('youtube.com'))  {
            if (window.location.href.includes('google.com') ||   window.location.href.includes('gmail.com')||window.location.href.includes('bing.com') ||   window.location.href.includes('grok.com')||   window.location.href.includes('taobao.com')||   window.location.href.includes('chatgpt.com') )  {

                if (!document.title.includes(`${myaccountprefix}`)) document.title =`${myaccountprefix}${document.title}`
                // title1 = document.querySelector('title').textContent;
                // if (!document.title.includes(`${formattedDate}`)) document.title =`${title1} ${formattedDate} ${formattedTime} ${currentURL}`.sanitizeWindowsFilename();

            } else {

                if (!document.title.includes(`${formattedDate}`)) document.title =` ${title3} ytc_none ${formattedDate} ${formattedTime} ${currentURL}`.sanitizeWindowsFilename();



            }

        }


    }

    setTimeout(updateTitle, 1000);
    setTimeout(updateTitle, 2000);
    setTimeout(updateTitle, 4000);
    setTimeout(updateTitle, 6000);
    setTimeout(updateTitle, 8000);
     setTimeout(updateTitle, 10000);
    setInterval(updateTitle, 3000); // Adjust delay as needed
    //  setInterval(updateTitle, 5000); // Adjust delay as needed
    // Run on page updates (e.g., navigating through YouTube)



    //TOOD explain:  if i uncomment this 2 lines , the title just becomes the last shorts's title , not the current shorts's title , no time to work on thsi .
    // var observer = new MutationObserver(updateTitle);
    // observer.observe(document.body, { childList: true, subtree: true });






})();