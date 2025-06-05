"use strict";
var UpstoxClient = require("upstox-js-sdk");
const WebSocket = require("ws").WebSocket;
const protobuf = require("protobufjs");
const API = require("./UpstocksAPIService");
const settings = require("../lib/Settings");
const qStocks = {};

let stockObs = {};
let stocks2watch = [];
let streamCallBack = null;

// Initialize global variables
let protobufRoot = null;
let defaultClient = UpstoxClient.ApiClient.instance;
let apiVersion = "2.0";
let OAUTH2 = defaultClient.authentications["OAUTH2"];
OAUTH2.accessToken = '';
// Function to authorize the market data feed
const getMarketFeedUrl = async () => {
    return new Promise((resolve, reject) => {
        let apiInstance = new UpstoxClient.WebsocketApi(); // Create new Websocket API instance

        // Call the getMarketDataFeedAuthorize function from the API
        apiInstance.getMarketDataFeedAuthorize(
            apiVersion,
            (error, data, response) => {
                if (error) reject(error); // If there's an error, reject the promise
                else resolve(data.data.authorizedRedirectUri); // Else, resolve the promise with the authorized URL
            }
        );
    });
};

// Function to establish WebSocket connection
const connectWebSocket = async (wsUrl) => {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, {
            headers: {
                "Api-Version": apiVersion,
                Authorization: "Bearer " + OAUTH2.accessToken,
            },
            followRedirects: true,
        });

        // WebSocket event handlers
        ws.on("open", () => {
            console.log("connected");
            resolve(ws); // Resolve the promise once connected
            // Set a timeout to send a subscription message after 1 second
            const instTokens = stocks2watch.map((item) => {
                qStocks[item.instrument_key] = {name:item.name,
                    instrument_key:item.instrument_key,
                    symbol:item.symbol
                }
                return item.instrument_key;
            });
            setTimeout(() => {
                const data = {
                    guid: "someguid",
                    method: "sub",
                    data: {
                        mode: "ltpc",
                        instrumentKeys: instTokens,
                    },
                };
                ws.send(Buffer.from(JSON.stringify(data)));
            }, 1000);
        });

        ws.on("close", () => {
            console.log("disconnected");
        });

        ws.on("message", (data) => {
            if(!streamCallBack){
                return;
            }
            let feeds = decodeProfobuf(data).feeds;
            for (const [key, value] of Object.entries(feeds)) {
                //console.log(value)
                if(qStocks[key]){
                    qStocks[key].price = value.ltpc.ltp
                    qStocks[key].cp = value.ltpc.cp
                    qStocks[key].ltt = value.ltpc.ltt.toNumber();
                    streamCallBack(qStocks[key]);
                }else{
                    streamCallBack( {
                        'instrument_key':key,
                        'price':value.ltpc.ltp,
                        'cp':value.ltpc.cp,
                        'ltt':value.ltpc.ltt,
                        'name':stockObs[key].name,
                        'symbol':stockObs[key].symbol,
                    });
                }
            }
        });
        ws.on("error", (error) => {
            console.log("error:", error);
            reject(error); // Reject the promise on error
        });
    });
};

// Function to initialize the protobuf part
const initProtobuf = async () => {
    protobufRoot = await protobuf.load(__dirname + "/MarketDataFeed.proto");
    console.log("Protobuf part initialization complete");
};


// Function to decode protobuf message
const decodeProfobuf = (buffer) => {
    if (!protobufRoot) {
        console.warn("Protobuf part not initialized yet!");
        return null;
    }
    const FeedResponse = protobufRoot.lookupType(
        "com.upstox.marketdatafeeder.rpc.proto.FeedResponse"
    );
    return FeedResponse.decode(buffer);
};

// Initialize the protobuf part and establish the WebSocket connection
exports.getMarketStream = async function(sts2watch, callBack) {
    streamCallBack = callBack;
    stocks2watch = sts2watch
    await initProtobuf(); // Initialize protobuf
    const wsUrl = await getMarketFeedUrl(); // Get the market feed URL
    return await connectWebSocket(wsUrl); // Connect to the WebSocket
}

exports.isTokenValid = async function(accessToken) {
    OAUTH2.accessToken = accessToken;
    return isValidAccessToken();
}
// Function to check if access token is valid
async function isValidAccessToken() {
    if (!OAUTH2.accessToken) {
        console.log("No access token available");
        return false;
    }

    try {
        await API.profile(OAUTH2.accessToken);
        console.log("Access token is valid");
        return true;
    } catch (error) {
        console.log("Access token validation failed:", error.message);
        return false;
    }
}
