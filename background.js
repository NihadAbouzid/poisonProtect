function initializeDataBase(){
    let objStore = database.createObjectStore("hosts", {keyPath: "hostName"});
    createdIndex = objStore.createIndex("lastModified", "lastModified", {unique:false});
    printMessage("start data storage procedure");
    for(let i = 1; i <= 1; i++){
        let currentFileName = 'dnsData' + i + '.json';
        loadJSON(function (data) {
            let objStore = database.transaction(["hosts"], "readwrite").objectStore("hosts");
            let entryList = Object.entries(data);
            entryList.forEach(function(hostData){
                hostData = {
                    "hostName": hostData[0],
                    "ips": hostData[1].ips,
                    "lastModified": new Date()
                };
                addHostData(hostData, objStore);
            });
            currentDBSize += entryList.length;
        }, currentFileName, objStore);
    }
    maxDBSize = currentDBSize * 1.1;
}

function getHostData(hostname) {
    let request = database.transaction(["hosts"]).objectStore("hosts").get(hostname);
    request.onsuccess = function(event){
        if(event.target.result === 'undefined'){
            return null;
        }
        return event.result;
    };
    request.onerror = function(){
        return null;
    }
}

function addHostData(hostData, objStore = null){
    if(objStore === null){
        objStore = database.transaction(["hosts"], "readwrite").objectStore("hosts");
    }
    let request = objStore.add(hostData);
    request.onsuccess = function(){
        if(++currentDBSize >= maxDBSize) { //delete oldest entry
            deleteOldestEntry(objStore);
        }
    };
}

function deleteOldestEntry(objStore){
    let cursorRequest = createdIndex.openCursor(null, "prev");
    cursorRequest.onsuccess = function(event) {
        let cursor = event.target.result;
        let deleteRequest = objStore.delete(cursor.key);
        deleteRequest.onsuccess = function(){
            currentDBSize--;
        }
    }
}

function loadJSON(callback, fileName) {
    let request = new XMLHttpRequest();
    request.overrideMimeType("application/json");
    request.open('GET', "./" + fileName, true);
    request.onreadystatechange = function () {
        if (request.readyState === 4 && request.status === 200) {
            callback(JSON.parse(request.responseText));
        }
    };
    request.send(null);
}

function verifyDomainIP(hostname, ipAddress){
    let hostInfo = getHostData(hostname);
    if(hostInfo === null){
        //hostInformation not present in the DB
    } else if(typeof hostInfo === 'object') {

    }
}

function beforeRequestCallback(){
    return {
        cancel: spoofingDetected
    };
}

function headersReceivedCallback(details){
    if(!spoofingDetected){
        try{
            let hostname = new URL(details.url).hostname;
            if(!hostname.includes(".") || hostname === "dns.google" || addressInformation.hostname !== undefined){
                return;
            }
            verifyDomainIP(hostname);
        } catch (exception) {
            printMessage("could not url for " + details.url, true);
        }
    }
}

function printMessage(message, error = false){
    if(error){
        console.error(message);
    } else {
        console.log(message);
    }
}

let database, createdIndex;
let spoofingDetected = false; //will be true if certain amount of request has non listed IPs
let currentDBSize = 0, maxDBSize = NUMBER.MAX_SAFE_INTEGER;
const ipv4Regex = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;

let urlFilter = {
    urls: ["<all_urls>"]
};
let headersReceivedOptions = ["extraHeaders"];
let beforeRequestOptions = ["blocking"];

chrome.runtime.onInstalled.addListener(function() {
    let openDBRequest = indexedDB.open('dnsDatabase', 1);
    openDBRequest.onblocked = function(){
        printMessage("Please close all other tabs with this site open!");
    };
    openDBRequest.onupgradeneeded = function(event){
        printMessage("update database");
        database = event.target.result;
        database.onerror = function(event){
            printMessage("Database error: " + event.target.errorCode)
        };
        initializeDataBase();
        printMessage("database update complete")
    };
});

chrome.webRequest.onBeforeRequest.addListener(beforeRequestCallback, urlFilter, beforeRequestOptions);
chrome.webRequest.onHeadersReceived.addListener(headersReceivedCallback, urlFilter, headersReceivedOptions);