let backgroundPage = chrome.extension.getBackgroundPage();
let headersReceivedCallback = function(details){
    backgroundPage.console.log(details);
    return {
        cancel: false
    };
};
let headersReceivedFilter = {
    urls: ["<all_urls>"]
};
let headersReceivedOptions = ["blocking"];

chrome.webRequest.onHeadersReceived.addListener(headersReceivedCallback, headersReceivedFilter, headersReceivedOptions);