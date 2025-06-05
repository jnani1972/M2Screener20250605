"use strict";
const API = require('./API')
//const portfolioTracker = require('./PortfolioTracker');
const settings = require('./Settings')
var clients = [];
var qualifiedStocks = {};
var stocks = {};
var accessToken = null;
const StockSignal = require('../models/StockSignal');
// In-memory cache for signals
const signalsCache = {};
const { Op } = require('sequelize');
async function initializeSignalsCache() {
    try {
        // Get today's start and end timestamps
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0); // Set time to 00:00:00
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999); // Set time to 23:59:59

        // Fetch only today's signals
        const allSignals = await StockSignal.findAll({
            where: {
                created_at: {
                    [Op.between]: [startOfDay, endOfDay] // Filter by today's date
                }
            }
        });

        // Populate the in-memory cache
        allSignals.forEach(signal => {
            signalsCache[signal.instrument_key] = {
                signal: signal.signal,
                signal_data: signal.signal_data ? JSON.parse(signal.signal_data) : null,
                at_price: signal.at_price,
                created_at: signal.created_at
            };
        });

        console.log('Signals cache initialized with today\'s signals:', signalsCache);
    } catch (err) {
        console.error('Error initializing signals cache:', err);
    }
}
initializeSignalsCache();

exports.setAccessToken = function (t) {
    accessToken = t;
}



const db = require('./db')
const queries = require('./sqls');
const logger = require('./logger'); // Import the logger
exports.process = async function (stockPrice) {
    stockPrice.change = (stockPrice.price - stockPrice.cp).toFixed(2);
    stockPrice.percentage = ((100 / stockPrice.cp) * stockPrice.change).toFixed(2);
    const baseStock = stocks[stockPrice['instrument_key']];
    if (baseStock) {
        pushToRenko(baseStock, stockPrice);
        //stockPrice.weekrsi = findWeek7Rsi(baseStock, stockPrice);
        stockPrice.dayrsi = findDay7Rsi(baseStock, stockPrice);
        stockPrice.minutersi = findMinute7rsi(baseStock, stockPrice);
        stockPrice.prevMinuteRsi = findPrevMinuteRsi(baseStock, stockPrice);
        stockPrice.dayatr = findDay7atr(baseStock, stockPrice);
        // stockPrice.dcLow = dcLow(baseStock, stockPrice);
    }
    signal(baseStock, stockPrice);
    qualifiedStocks[stockPrice['instrument_key']] = stockPrice;
    if (webSocket) {
        webSocket.send(JSON.stringify(qualifiedStocks));
    }
}

function signal(baseStock, stockPrice) {
    if (stockPrice.signal && stockPrice.signal === 'BUY') {
        return;
    }
    restoreSignal(stockPrice)
    stockPrice.atrDiff = ((0 - stockPrice.dayatr * settings.entryConditions.day_atr_entry_multiplier) - stockPrice.percentage).toFixed(2);
    if ((0 - stockPrice.dayatr * settings.entryConditions.day_atr_entry_multiplier) > stockPrice.percentage) {
        if (stockPrice.weekrsi > settings.entryConditions.week_rsi_entry_threshold ||
            stockPrice.dayrsi > settings.entryConditions.day_rsi_entry_threshold) {
            if (stockPrice.minutersi > stockPrice.prevMinuteRsi &&
                stockPrice.minutersi > settings.entryConditions.min_rsi_entry_threshold
                && stockPrice.price > stockPrice.dcLow) {
                stockPrice.signal = 'BUY'
                stockPrice.buyAt = stockPrice.price;
                // Save updated signals to JSON file
                saveSignal(stockPrice);
            }
        }
    }
}
async function saveSignal(signalData) {
    signalsCache[signalData.instrument_key] = {
        signal: signalData.signal,
        at_price: signalData.buyAt
    };
    // Update database
    StockSignal.upsert({
        instrument_key: signalData.instrument_key,
        signal: signalData.signal,
        signal_data: JSON.stringify(signalData),
        at_price: signalData.buyAt
    }).then(res => {
        console.log('saved Signal:');
    }).catch(err => {
        console.error('Error saving signal:', err);
    });
}

// Function to restore signals
function restoreSignal(stockPrice) {
    const cachedSignal = signalsCache[stockPrice.instrument_key];
    if (cachedSignal) {
        stockPrice.signal = cachedSignal.signal;
        stockPrice.buyAt = cachedSignal.at_price;
        stockPrice.signaledOn = cachedSignal.created_at;
    }
    return stockPrice;
}
function dcLow(baseStock, stockPrice) {
    if (!baseStock.minuteCandles || !baseStock.minuteCandles.length) {
        return 0;
    }
    let currentTimestamp = Math.floor(stockPrice.ltt / 60000) * 60000; // Normalize to minute timestamp
    let lastCandle = baseStock.minuteCandles[0];
    let lastCandleTimestamp = new Date(lastCandle[0]).getTime();
    if (lastCandleTimestamp !== currentTimestamp) {
        // New minute, start a new candle
        let newCandle = [currentTimestamp, stockPrice.price, stockPrice.price, stockPrice.price, stockPrice.price, 0];
        baseStock.minuteCandles.unshift(newCandle); // Add new candle at the beginning
    } else {
        // Update the existing candle
        lastCandle[2] = Math.max(lastCandle[2], stockPrice.price); // High
        lastCandle[3] = Math.min(lastCandle[3], stockPrice.price); // Low
        lastCandle[4] = stockPrice.price; // Close
    }
    if (baseStock.minuteCandles.length < settings.strategyInputs.dc_low_lbp) {
        return 0;
    }
    let dcLow = baseStock.minuteCandles[settings.strategyInputs.dc_low_lbp - 1][3];
    for (let i = settings.strategyInputs.dc_low_lbp; i < settings.strategyInputs.dc_low_lbp * 2; i++) {
        dcLow = Math.min(baseStock.minuteCandles[i][3], dcLow);
    }
    return dcLow;
}


/*function calculateBBHybridFromRenko(renkoPrices, length = 20, multiplier = 2.0) {
    const results = [];

    for (let i = length; i < renkoPrices.length; i++) {
        const slice = renkoPrices.slice(i - length, i);

        // SMA
        const sma = slice.reduce((sum, val) => sum + val, 0) / length;

        // Standard Deviation
        const mean = sma;
        const stdev = Math.sqrt(slice.reduce((acc, val) => acc + (val - mean) ** 2, 0) / length);

        // ATR: average of absolute diffs between consecutive Renko bricks
        const atr = slice.slice(1).reduce((acc, val, idx) => acc + Math.abs(val - slice[idx]), 0) / (length - 1);

        // Hybrid deviation: 50% stdev + 50% ATR
        const dev = multiplier * (stdev + atr) / 2;

        const upper = sma + dev;
        const lower = sma - dev;

        const bbr = (renkoPrices[i] - lower) / (upper - lower);
        const bbr_scaled = (bbr - 0.5) * 200;
        const bbr_clamped = Math.max(-100, Math.min(100, bbr_scaled));

        results.push({
            index: i,
            price: renkoPrices[i],
            bbr_clamped
        });
    }

    return results;
}*/


function findDay7Rsi(baseStock) {
    const bricks = baseStock.renkoBricks;
    if (!bricks || bricks.length < 376) return 0;

    const daySample = bricks.slice(0, 376); // Most recent ~1 day (Renko bricks)
    return findRenkoRsi(daySample);
}

function findMinute7rsi(baseStock) {
    const bricks = baseStock.renkoBricks;
    if (!bricks || bricks.length < 16) return 0;

    const shortSample = bricks.slice(0, 16); // Most recent ~15-16 bricks
    return findRenkoRsi(shortSample);
}

function findPrevMinuteRsi(baseStock) {
    const bricks = baseStock.renkoBricks;
    if (!bricks || bricks.length < 31) return 0;

    const prevSample = bricks.slice(15, 31); // Previous 16 bricks
    return findRenkoRsi(prevSample);
}

function findRenkoRsi(renkoData) {
    let gains = 0;
    let losses = 0;

    for (let i = 0; i < renkoData.length - 1; i++) {
        let change = renkoData[i] - renkoData[i + 1]; // Bricks are ordered newest-first
        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    const period = renkoData.length - 1;
    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100; // Max RSI

    const RS = avgGain / avgLoss;
    const RSI = 100 - (100 / (1 + RS));

    return RSI.toFixed(2);
}



// function getRenkoBricks(prevRenko, ltp, brickSizePrice, maxBricks = 1000) {
//     const bricks = [];
//     const direction = ltp >= prevRenko ? 1 : -1;
//     if (isNaN(ltp - prevRenko)) {
//         return bricks;
//     }
//     const diff = ltp - prevRenko;
//     if (brickSizePrice <= 0) {
//         return bricks;
//     }
//     const numBricks = Math.floor(Math.abs(diff) / brickSizePrice, maxBricks);
//     try {
//         for (let i = 1; i <= numBricks; i++) {
//             bricks.push((prevRenko + direction * i * brickSizePrice));
//         }
//     } catch (err) {

//     }

//     return bricks;
// }



function findDay7atr(baseStock, stockPrice) {
    const bricks = baseStock.renkoBricks;
    if (!bricks || bricks.length < 376) {
        return 0; // Not enough data
    }

    const batchSize = 376; // Approx 1 day of 1-min candles
    const trueRanges = [];

    for (let i = 0; i < bricks.length; i += batchSize) {
        const batch = bricks.slice(i, i + batchSize);
        if (batch.length < batchSize) {
            continue;
        }
        const tr = findTR(batch);
        trueRanges.push(tr);
    }

    if (!trueRanges.length) {
        return 0;
    }

    const atr = trueRanges.reduce((sum, val) => sum + val, 0) / trueRanges.length;
    return ((atr / stockPrice.price) * 100).toFixed(2); // ATR as % of price
}

function findTR(brickArray) {
    const min = Math.min(...brickArray);
    const max = Math.max(...brickArray);
    return max - min;
}

async function processForOrder() {
    for (var i = 0; i < clients.length; i++) {
        const client = clients[i];
        try {
            let resp = await openOrder(client.id, stockPrice)
            if (resp.length) {
                continue;
            }
            const respTrade = await activeTrade(client.id, stockPrice)
            if (respTrade.length) {
                //Exit Criteria login
                continue;
            }
            const accessToken = client.access_token;
            resp = await API.margins(accessToken);
            const marginsAvailable = resp.data.data.equity.available_margin
            const qty = quantity2Buy(marginsAvailable, client, stockPrice);
            logger.logInfo(`Quantity to buy for client ${client.id}(${client.name}): ${qty}`).catch(err => { console.log(err.message) }); // Log quantity to buy
            if (!qty) {
                continue;
            }
            console.log("Placing order for " + stockPrice.instrument_token + " by qty " + qty)
            const clientOrder = await saveClientOrder(client, stockPrice, qty);
            const respOrder = await API.placeOrder({
                "quantity": qty,
                "product": "D",
                "validity": "DAY",
                "price": stockPrice.ltp,
                "tag": "string",
                "instrument_token": stockPrice.instrument_token,
                "order_type": "LIMIT",
                "transaction_type": "BUY",
                "disclosed_quantity": 0,
                "trigger_price": 0,
                "is_amo": false
            }, accessToken);
            clientOrder.order_id = respOrder.data.data.order_id;
            await updateClientOrder(clientOrder);
            await logger.logInfo(`Order placed for client ${client.id}: ${clientOrder.order_id}`); // Log successful order placement
        } catch (err) {
            logger.logError(`Error processing order for client ${client.id}: ${err.message}`).catch(err => { console.log(err.message) }); // Log error during order processing
        }
    }
}
function openOrder(clientId, stock) {
    const q = "select * from orders o \n" +
        "where o.client_id = " + clientId +
        " and o.instrument_token = '" + stock.instrument_token + "'" +
        " and o.status in ('open', 'draft')"
    return db.get(q)
}

function activeTrade(clientId, stock) {
    const q = "SELECT * from trades t \n" +
        "where t.client_id = " + clientId + " \n" +
        "and t.instrument_token = '" + stock.instrument_token + "' \n" +
        // "and t.avl_quantity > 0 \n" +
        "order by t.created_at DESC \n" +
        "limit 1"
    return db.get(q)
}

function quantity2Buy(margins, client, stock) {
    /*if(margins < settings.tradeSettings.PER_ORDER_VALUE){
        logger.logInfo(`Margins not sufficient to place order : ${client.id}(${client.name}):`).catch(err=>{console.log(err.message)});
        return 0;
    }*/
    let qty = Math.floor(settings.tradeSettings.PER_ORDER_VALUE / stock.ltp);
    return qty > 1 ? 1 : qty; //Only for testing
}
function saveClientOrder(client, stock, quantity) {
    console.log(stock.instrument_token + " to order")
    if (!client.stocks[stock.instrument_token]) {
        client.stocks[stock.instrument_token] = { orders: [] }
    }
    if (!client.stocks[stock.instrument_token].orders) {
        client.stocks[stock.instrument_token].orders = [];
    }
    const orderData = {
        client_id: client.id,
        order_id: null,
        instrument_token: stock.instrument_token,
        quantity: quantity,
        transaction_type: 'BUY',
        price: stock.ltp,
        status: 'draft'
    }
    return db.post('orders', orderData).then(async (resp) => {
        const orderdCreated = await db.get('SELECT id, client_id, order_id,instrument_token,quantity,price,status,transaction_type FROM orders where id = ' + resp.insertId);
        client.stocks[stock.instrument_token].orders.push(orderdCreated[0]);
        return orderdCreated[0];
    });
}
function updateClientOrder(clientOrder) {
    return db.put('orders', clientOrder, { 'id': clientOrder.id });
}

// Main Historical Data Setup and Initial Renko Computation
exports.getHistory = async function (inputStocks) {
    let counter = 0;

    for (let i = 0; i < inputStocks.length; i++) {
        try {
            const stock = inputStocks[i];

            // Download 10-day 1-min candles
            const res = await API.history(accessToken, stock, '1minute', 10);
            const historyCandles = res.data.data.candles || [];

            // Download today's intraday 1-min candles
            const res2 = await API.intraDayCandles(accessToken, stock);
            const todayCandles = res2.data.data.candles || [];

            // Merge with today first (assumes both are in ascending order)
            const allCandles = todayCandles.concat(historyCandles);
            allCandles.reverse()
            stock.ohlcCandles = allCandles;
            console.log(stock.ohlcCandles[stock.ohlcCandles.length - 1]);
            console.log(stock.ohlcCandles[0]);
            console.log(stock.name, 'Total candles:', allCandles.length);

            // Calculate Renko
            const [renkoBricks, brickSize] = calculateRenko(allCandles, allCandles.length);
            stock.renkoBricks = renkoBricks;
            stock.brickSize = brickSize;

            console.log(stock.name, 'Renko bricks:', renkoBricks.length);

            // Save to global
            stocks[stock.instrument_key] = stock;

        } catch (err) {
            console.error("Error processing", inputStocks[i].name, err);
        }

        if (counter >= 10) {
            counter = 0;
            console.log('Throttling: sleeping for 1.2 sec');
            await sleep(1200);
        } else {
            counter++;
        }
    }
}


// Renko Brick Calculator
function calculateRenko(ohlcData, lbp) {
    const renkoBricks = [];
    if (ohlcData.length < lbp) return [renkoBricks, 0];

    // Fixed brick size from average price
    let totalAvgPrice = 0;
    for (let i = 0; i < lbp; i++) {
        const c = ohlcData[i];
        totalAvgPrice += (c[1] + c[2] + c[3] + c[4]) / 4;
    }
    const avgPrice = totalAvgPrice / lbp;
    const brickSizePrice = Math.round((avgPrice * 0.001) * 20) / 20;

    let renkoPrice = ohlcData[0][4]; // Starting from first candle close

    for (let i = 0; i < lbp; i++) {
        const candleClose = ohlcData[i][4];
        const newBricks = getRenkoBricks(renkoPrice, candleClose, brickSizePrice);
        if (newBricks.length > 0) {
            //newBricks.reverse();

            renkoBricks.push(...newBricks);
            if (i < 1000) {
                console.log(newBricks);
                console.log(renkoBricks)
            }
            renkoPrice = renkoBricks[renkoBricks.length - 1];
        }

        // Optional: limit size
        if (renkoBricks.length > 3750) {
            renkoBricks.splice(0, renkoBricks.length - 3750);
        }
    }

    return [renkoBricks.reverse(), brickSizePrice]; // newest brick at index 0
}


// Real-Time Renko Update from LTP
function pushToRenko(baseStock, stockPrice) {
    if (!baseStock.renkoBricks || baseStock.renkoBricks.length === 0) return;

    const ltp = stockPrice.price;
    const lastBrick = baseStock.renkoBricks[0];

    const newBricks = getRenkoBricks(lastBrick, ltp, baseStock.brickSize);

    if (newBricks.length > 0) {
        // Reverse to maintain newest-first order
        newBricks.reverse();
        baseStock.renkoBricks.unshift(...newBricks);

        // Trim oldest bricks from the end
        while (baseStock.renkoBricks.length > 3750) {
            baseStock.renkoBricks.pop();
        }
    }
}


// Generates Renko bricks from a price move
function getRenkoBricks(prevRenko, ltp, brickSizePrice, maxBricks = 1000) {
    const bricks = [];

    if (isNaN(ltp - prevRenko) || brickSizePrice <= 0) {
        return bricks;
    }

    const diff = ltp - prevRenko;
    const direction = diff >= 0 ? 1 : -1;
    const numBricks = Math.min(Math.floor(Math.abs(diff) / brickSizePrice), maxBricks);

    for (let i = 1; i <= numBricks; i++) {
        bricks.push(prevRenko + direction * i * brickSizePrice);
    }

    return bricks;
}


async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


