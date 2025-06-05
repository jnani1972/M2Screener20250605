"use strict";
const API = require('../services/UpstocksAPIService')
const DataPusher = require('../services/DataPusher')
const settings = require('../Settings')
var qualifiedStocks = {};
var stocks = {};
var accessToken = null;
const StockSignal = require('../models/StockSignal');
// In-memory cache for signals
const signalsCache = {};
const { Op } = require('sequelize');
DataPusher.startServer(qualifiedStocks);
exports.initCache =  async function () {
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
exports.setAccessToken = function (t) {
    accessToken = t;
    return qualifiedStocks;
}
exports.getQStocks = function () {
    return stocks;
}
exports.process = async function (stockPrice) {
    stockPrice.change = (stockPrice.price - stockPrice.cp).toFixed(2);
    stockPrice.percentage = ((100 / stockPrice.cp) * stockPrice.change).toFixed(2);
    const baseStock = stocks[stockPrice['instrument_key']];
    if (baseStock) {
        pushToRenko(baseStock, stockPrice);
        stockPrice.dayrsi = findDay7Rsi(baseStock, stockPrice);
        stockPrice.minutersi = findMinute7rsi(baseStock, stockPrice);
        stockPrice.prevMinuteRsi = findPrevMinuteRsi(baseStock, stockPrice);
        stockPrice.dayatr = findDay7atr(baseStock, stockPrice);
        // stockPrice.dcLow = dcLow(baseStock, stockPrice);
    }
    signal(baseStock, stockPrice);
    qualifiedStocks[stockPrice['instrument_key']] = stockPrice;
    setTimeout(() => {
        DataPusher.pushStocksUpdate();
    }, 1000*10)
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
            const [renkoBricks, brickSize, rData] = calculateRenko(allCandles, allCandles.length);
            stock.renkoBricks = renkoBricks;
            stock.brickSize = brickSize;
            stock.rData = rData;
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
    const rData = [];
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
    let tempBricks = [];
    for (let i = 0; i < lbp; i++) {
        const candleClose = ohlcData[i][4];
        const newBricks = getRenkoBricks(renkoPrice, candleClose, brickSizePrice);
        if (newBricks.length > 0) {
            //newBricks.reverse();
            renkoBricks.push(...newBricks);
            renkoPrice = renkoBricks[renkoBricks.length - 1];
            rData.push({bricks:[...newBricks], price:candleClose, time:ohlcData[i][0]});
            tempBricks = [...newBricks];
        }else{
            rData.push({bricks:[...tempBricks], price:candleClose, time:ohlcData[i][0]});
        }
        // Optional: limit size
        if (renkoBricks.length > 3750) {
            renkoBricks.splice(0, renkoBricks.length - 3750);
        }
    }

    return [renkoBricks.reverse(), brickSizePrice, rData]; // newest brick at index 0
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
        //baseStock.rData.push({bricks:[...newBricks], price:ltp, time:stockPrice.ltt})
    }
    //console.log(baseStock.rData);
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


