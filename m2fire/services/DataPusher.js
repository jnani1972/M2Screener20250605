"use strict";
const WebSocket = require('ws');

var server = null;
var clients = []; // List of { ws, type }
var stocks = {};
var tradeData = {};
let pushingStocks = false; // Flag to track ongoing push
exports.startServer = function (stocksData, trData) {
    tradeData = trData;
    stocks = stocksData;

    server = new WebSocket.Server({ port: 8080 });

    server.on('connection', ws => {
        console.log('Client connected');

        ws.on('message', message => {
            // First message decides the type
            try {
                const data = JSON.parse(message);
                if (data.type === 'stocks' || data.type === 'tradeData' || data.type === 'price') {
                    clients.push({ ws, type: data.type });

                    if (data.type === 'stocks') {
                        ws.send(JSON.stringify({ type: 'stocks', data: stocks }));
                    } else if (data.type === 'tradeData') {
                        ws.send(JSON.stringify({ type: 'tradeData', data: tradeData }));
                    }else if (data.type === 'price') {
                        const prices = {};
                        for (const dataKey in stocks) {
                            prices[dataKey] = {price:stocks[dataKey].price, name:stocks[dataKey].name}
                        }
                        ws.send(JSON.stringify({ type: 'price', data: prices }));
                    }
                }
            } catch (e) {
                console.error('Invalid message', message);
            }
        });

        ws.on('close', () => {
            console.log('Client disconnected');
            clients = clients.filter(client => client.ws !== ws);
        });
    });

    console.log("WebSocket server running on ws://localhost:8080");
};

exports.pushStocksUpdate = async function () {
    if (pushingStocks) {
        //console.log('Stocks push already in progress, skipping this call.');
        return; // Simply skip if already pushing
    }

    pushingStocks = true;
    const stocksArray = Object.values(stocks); // convert stocks object to array
    const batchSize = 10;

    try {
        const prices = {};
        for (const dataKey in stocks) {
            prices[dataKey] = {price:stocks[dataKey].price, name:stocks[dataKey].name, ccps:stocks[dataKey].ccps, pcps:stocks[dataKey].pcps}
        }
        broadcastBatch('price', prices);
        await sleep(10);
        for (let i = 0; i < stocksArray.length; i += batchSize) {
            const batch = stocksArray.slice(i, i + batchSize);
            broadcastBatch('stocks', batch);
            await sleep(10);
        }
    } catch (err) {
        console.error('Error during stocks push:', err);
    } finally {
        pushingStocks = false; // Always reset flag
    }
};

function broadcastBatch(type, batch) {
    clients.forEach(client => {
        if (client.type === type && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type, data: batch }));
        }
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

exports.pushTradeDataUpdate = async function () {
    broadcast('tradeData', tradeData);
};

function broadcast(type, data) {
    clients.forEach(client => {
        if (client.type === type && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type, data }));
        }
    });
}
