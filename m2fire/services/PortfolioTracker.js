"use strict";
// Import required modules
var UpstoxClient = require("upstox-js-sdk");
const WebSocket = require("ws").WebSocket;

// Initialize global variables
let defaultClient = UpstoxClient.ApiClient.instance;
let apiVersion = "2.0";
let OAUTH2 = defaultClient.authentications["OAUTH2"];

let TradeManagement = null;

exports.connect = async function (access_token, tManager){
    OAUTH2.accessToken = access_token
    TradeManagement = tManager;
    try {
        const wsUrl = await getPortfolioTrackerUrl(); // Get the market feed URL
        const ws = await connectWebSocket(wsUrl); // Connect to the WebSocket
    } catch (error) {
        console.error("An error occurred:", error.message);
    }
}

// Function to authorize the market data feed
const getPortfolioTrackerUrl = async () => {
    return new Promise((resolve, reject) => {
        let apiInstance = new UpstoxClient.WebsocketApi(); // Create new Websocket API instance
        apiInstance.getPortfolioStreamFeedAuthorize(
            apiVersion,
            async (error, data, response) => {
                if (error) {
                    reject(error); // If there's an error, reject the promise
                } else {
                    resolve(data.data.authorizedRedirectUri); // Else, resolve the promise with the authorized URL
                }
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
            console.log("Connected to portfolio stream");
            resolve(ws); // Resolve the promise once connected
        });

        ws.on("close", () => {
            console.log("Portfolio Disconnected");
        });
        ws.on("message", async (data) => {
            const parsedData = JSON.parse(data.toString());
            console.log(parsedData)
            try {
                if (parsedData.update_type === 'order') {
                    TradeManagement.updateOrder(parsedData);
                }
            } catch (err) {
                console.log(err.message);
            }
        });
        ws.on("error", async (error) => {
            console.log("error:", error);
            reject(error); // Reject the promise on error
        });
    });
};

// Adding a newline at the end of the file
