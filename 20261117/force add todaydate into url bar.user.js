// ==UserScript==
// @name         force add todaydate into url bar
// @namespace    http://tampermonkey.net/
// @version      2024-10-10
// @description  try to take over the world!
// @author       You
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @grant        none
// ==/UserScript==


//   force add todaydate into url bar  , in this 'dirty way' you can just by typing in chrome history '20230708 '
//   to directly locate the page you visited at 20230708
//   after all , chrome history 's limit is approx 3 months


var jcxsession_var='session var val';
let jcxsession_let='session let val';
window.jcxsession_var = 'session var val';
window.jcxsession_let = 'session let val';

(function() {
    'use strict';




function getFormattedTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}${minutes}${seconds}`;
}






function getFormattedDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(today.getDate()).padStart(2, '0'); // Ensure two digits
    return `${year}${month}${day}`;
}

// Set the substring with the current date
    //${getFormattedTime()}
var substringToCheck = `&todaydate=${getFormattedDate()}\$\$`;
if (!window.location.href.includes('youtube.com')) {
    substringToCheck += '&3rdsite=1'; // Modify the existing variable
}













// Set an interval to check every 5 seconds
setInterval(() => {
    // Get the current URL
    let currentUrl = window.location.href;

    // Check if the current URL contains the substring
    if (!currentUrl.includes('todaydate')) {
        // If not, add the substring to the current URL
        let newUrl;

        // Check if there's already a query string in the URL
        if (currentUrl.includes('?')) {
            // If there is, append the new parameter
            newUrl = `${currentUrl}${substringToCheck}`;
        } else {
            // If not, create a new query string
            newUrl = `${currentUrl}?${substringToCheck}`;
        }

        // Replace the current state with the new URL
        history.replaceState(null, '', newUrl);
        console.log(`Updated URL: ${newUrl}`); // Log the updated URL (optional)
    }
}, 1000); // Run the check every 5000 milliseconds (5 seconds)


})();