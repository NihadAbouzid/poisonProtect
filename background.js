function initializeDataBase(){
    let objStore = database.createObjectStore("hosts", {keyPath: "hostName"});
    createdIndex = objStore.createIndex("lastModified", "lastModified", {unique:false});
    printMessage("start data storage procedure");
    for(let i = 1; i <= 1; i++){
        let currentFileName = 'dnsData' + i + '.json';
        loadJSON(function (data) {
            let objStore = database.transaction(["hosts"], "readwrite").objectStore("hosts");
            let entryList = Object.entries(data);
            let counter = 0;
            entryList.forEach(function(hostData){
                hostData = {
                    "hostName": hostData[0],
                    "ips": hostData[1].ips,
                    "lastModified": new Date()
                };
                counter++;
                let callback = null;
                if(counter === entryList.length){
                    callback = function() {
                        maxDBSize = currentDBSize * 1.1;
                    }
                }
                saveHostData(hostData, objStore, callback);
            });
            currentDBSize += entryList.length;
        }, currentFileName, objStore);
    }
}

function getHostData(hostname, ipAddress, callback) {
    checkTemporaryData(function(hostname, ipAddress, callback){
        let request = database.transaction(["hosts"]).objectStore("hosts").get(hostname);
        request.onsuccess = function(event){
            if(event.target.result === 'undefined'){
                callback(hostname, ipAddress);
            }
            callback(event.result, ipAddress);
        };
        request.onerror = function(){
            callback(null);
        }
    }, hostname, ipAddress, callback);
}

function saveHostData(hostData, objStore = null, callback = null){
    checkTemporaryData(function(hostData, objStore = null, callback = null){
        if(objStore === null){
            objStore = database.transaction(["hosts"], "readwrite").objectStore("hosts");
        }
        let request = objStore.put(hostData);
        request.onsuccess = function(){
            if (callback !== null){
                callback();
            }
            if(++currentDBSize >= maxDBSize) { //delete oldest entry
                deleteOldestEntry(objStore);
            }
        };
        if (callback !== null){
            request.onerror = function(){
                callback();
            }
        }
    }, hostData, objStore, callback);
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

function getMaxPercentageOfWrongIPRequests(requestNumber){
    if(requestNumber > 9){
        return detectWrongIPsThreshold;
    }
    let startValue = 0.5;
    if(requestNumber > 2){
        startValue -= (requestNumber - 2) * 0.05
    }
    return startValue;
}

function checkSpoofingValueForUpdate(requestWithWrongIP = false) {
    let updateRequestCount = 0, nonUpdateRequestCount = 0;
    if(lastDistinctRequests.length > 0) {
        updateRequestCount = lastDistinctRequests.filter(request => request.ipUpdate).length;
    }
    if(!requestWithWrongIP){
        if (spoofingDetected && updateRequestCount === 0) { //spoofing has been detected but no suspicious request has been made lately
            spoofingDetected = false;
        }
    } else if(updateRequestCount > 0 &&
        updateRequestCount > lastDistinctRequests.length * getMaxPercentageOfWrongIPRequests(lastDistinctRequests.length)) {
        spoofingDetected = true;
    }
    if(updateRequestCount > maxNumOfInitialWrongIPs && nonUpdateRequestCount === 0){ //only update requests
        spoofingDetected = true;
    }
}

function verifyDomainIP(hostInfo, ipAddress) {
    if(hostInfo === null){
        return;
    }
    let requestLogObject = {
        "ipUpdate": !spoofingDetected,
        "timestamp": new Date()
    };
    if(typeof hostInfo === 'string') { //hostInformation not present in the DB; block unknown origins when spoofingDetected
        requestLogObject.hostName = hostInfo;
        checkSpoofingValueForUpdate();
        if(!spoofingDetected){
            saveHostData({
                "hostName": hostInfo,
                "ips": [ipAddress],
                "lastModified": new Date()
            });
        }
    } else if(typeof hostInfo === 'object') {
        requestLogObject["hostName"] = hostInfo.hostName;
        if(hostInfo.ips.contains(ipAddress)){
            requestLogObject.ipUpdate = false;
            checkSpoofingValueForUpdate();
        } else {
            //update if no spoofing detected
            checkSpoofingValueForUpdate(true);
            if(!spoofingDetected) {
                hostInfo.ips.append(ipAddress);
                saveHostData(hostInfo);
            }
        }
    }

    let currentTime = new Date();
    let oldRequests = lastDistinctRequests.filter(request => diffMinutes(request.timestamp, currentTime) > requestsSaveDurationMinutes);
    if(oldRequests.length > 0) {
        lastDistinctRequests.slice(0, oldRequests.length);
    }
    addRequestToTempStorage(requestLogObject);
}

function addRequestToTempStorage(requestLogObject){
    let hostNameIndex = lastDistinctRequests.indexOf(requestLogObject.hostName);
    if(hostNameIndex !== -1){
        lastDistinctRequests.slice(hostNameIndex, 1);
    }
    lastDistinctRequests.append(requestLogObject);
    lastDistinctRequests.sort();
    hostNameIndex = lastDistinctRequests.indexOf(requestLogObject);
    removeLowerPriorityObject(hostNameIndex + 1, hostNameIndex, requestLogObject);
    removeLowerPriorityObject(hostNameIndex - 1, hostNameIndex, requestLogObject);
}

function removeLowerPriorityObject(oldIndex, newIndex, requestLogObject){
    let oldObject = lastDistinctRequests[oldIndex];
    if(oldObject === undefined){ //index out of bounds
        return;
    }
    if(oldObject.hostName.includes(requestLogObject.hostName)){
        if(oldObject.ipUpdate && !requestLogObject.ipUpdate){
            lastDistinctRequests.slice(newIndex, 1);
        } else {
            lastDistinctRequests.slice(oldIndex, 1);
        }
    }
}

function diffMinutes(timeStamp1, timeStamp2){
    let diffMilliSeconds = 0;
    if(timeStamp1 < timeStamp2) {
        diffMilliSeconds = timeStamp2 - timeStamp1;
    } else if(timeStamp2 < timeStamp1) {
        diffMilliSeconds = timeStamp1 - timeStamp2;
    }
    return diffMilliSeconds / 60000;
}

function beforeRequestCallback(){
    return {
        cancel: spoofingDetected
    };
}

function responseStartedCallback(details){
    if(!spoofingDetected){
        try{
            let hostname = new URL(details.url).hostname.split("").reverse().join("");
            //test for hostname validity and that the returned IP is an Ipv4 address as Ipv6 is not supported
            if(!hostname.includes(".") || !ipv4Regex.test(details.ip)){
                return;
            }
            getHostData(hostname, details.ip, verifyDomainIP);
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

function checkTemporaryData(callback = null, ...args){
    spoofingDetected = false;
    lastDistinctRequests = [];
    if(database === undefined){
        let openDBRequest = indexedDB.open("dnsDatabase", 1);
        openDBRequest.onblocked = function(){
            printMessage("Please close all other tabs with this site open!");
        };
        openDBRequest.onsuccess = function(event){
            database = event.target.result;
            let objStore = database.transaction(["hosts"]).objectStore("hosts")
            currentDBSize = objStore.count();
            if(currentDBSize > 0){
                maxDBSize = currentDBSize * 1.1;
            }
            try{
                createdIndex = objStore.index("lastModified");   
            } catch (e if e instanceof NotFoundError) {} //data and index not created yet
            if(callback !== null){
                callback(...args);
            }
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
    }
}

let database, createdIndex, lastDistinctRequests, spoofingDetected; //will be true if certain amount of request has non listed IPs
let currentDBSize = 0, maxDBSize = Number.MAX_SAFE_INTEGER;
const ipv4Regex = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;
const requestsSaveDurationMinutes = 5, detectWrongIPsThreshold = 0.05, maxNumOfInitialWrongIPs = 1;

const urlFilter = {
    urls: ["<all_urls>"]
};
const headersReceivedOptions = ["extraHeaders"];
const beforeRequestOptions = ["blocking"];

chrome.runtime.onInstalled.addListener(checkTemporaryData);
chrome.webRequest.onBeforeRequest.addListener(beforeRequestCallback, urlFilter, beforeRequestOptions);
chrome.webRequest.onResponseStarted.addListener(responseStartedCallback, urlFilter, headersReceivedOptions);