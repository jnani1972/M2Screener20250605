"use strict";
const settings = require('../Settings')
var qualifiedStocks = {};
var stocks = {};
var accessToken = null;
const StockSignal = require('../models/StockSignal');
const DataPusher = require('../services/DataPusher');
DataPusher.startServer(qualifiedStocks);
// In-memory cache for signals
const signalsCache = {};
const { Op } = require('sequelize');
const API = require("../services/UpstocksAPIService");
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

exports.initCache = function (){
    initializeSignalsCache();
}

exports.process = async function (stockPrice){
    stockPrice.change = (stockPrice.price - stockPrice.cp).toFixed(2);
    stockPrice.percentage = ((100/stockPrice.cp) * stockPrice.change).toFixed(2);
    const baseStock = stocks[stockPrice['instrument_key']];
    if(baseStock){
        stockPrice.weekrsi = findWeek7Rsi(baseStock, stockPrice);
        stockPrice.dayrsi = findDay7Rsi(baseStock, stockPrice);
        stockPrice.minutersi = findMinute7rsi(baseStock, stockPrice);
        stockPrice.prevMinuteRsi = findPrevMinuteRsi(baseStock, stockPrice);
        stockPrice.dayatr = findDay7atr(baseStock, stockPrice);
        stockPrice.dcLow = dcLow(baseStock, stockPrice);
    }
    signal(baseStock, stockPrice);
    qualifiedStocks[stockPrice['instrument_key']] = stockPrice;
    DataPusher.push2socket();
}
function signal(baseStock, stockPrice){
    if (stockPrice.signal && stockPrice.signal === 'BUY' ){
        return;
    }
    restoreSignal(stockPrice)
    stockPrice.atrDiff = ((0 - stockPrice.dayatr * settings.entryConditions.day_atr_entry_multiplier) - stockPrice.percentage).toFixed(2);
    if((0 - stockPrice.dayatr * settings.entryConditions.day_atr_entry_multiplier) > stockPrice.percentage){
        if(stockPrice.weekrsi > settings.entryConditions.week_rsi_entry_threshold ||
            stockPrice.dayrsi > settings.entryConditions.day_rsi_entry_threshold){
            if(stockPrice.minutersi > stockPrice.prevMinuteRsi &&
                stockPrice.minutersi > settings.entryConditions.min_rsi_entry_threshold
                && stockPrice.price > stockPrice.dcLow){
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
function dcLow(baseStock, stockPrice){
    if (!baseStock.minuteCandles || !baseStock.minuteCandles.length) {
        return 0;
    }
    let currentTimestamp = Math.floor(stockPrice.ltt / 60000) * 60000; // Normalize to minute timestamp
    let lastCandle = baseStock.minuteCandles.length > 0 ? baseStock.minuteCandles[0] : null;
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

    if (baseStock.minuteCandles.length < settings.strategyInputs.dc_low_lbp * 2) { // We need 8 candles to calculate 7 changes
        return 0;
    }
    let dcLow = baseStock.minuteCandles[settings.strategyInputs.dc_low_lbp-1][3];
    for (let i= settings.strategyInputs.dc_low_lbp; i <  settings.strategyInputs.dc_low_lbp * 2; i++){
        dcLow = Math.min(baseStock.minuteCandles[i][3], dcLow);
    }
    return dcLow;
}

function findWeek7Rsi(baseStock, stockPrice){
    // Initialize weekCandles array if it doesn't exist
    if (!baseStock.weekCandles || !Array.isArray(baseStock.weekCandles)) {
        baseStock.weekCandles = [];
    }
    // Get current week's Monday at 00:00:00
    const getCurrentWeekStart = () => {
        const date = new Date();
        const day = date.getDay(); // 0 = Sunday
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(date.setDate(diff));
        weekStart.setHours(0, 0, 0, 0);
        return weekStart;
    };

    const currentWeekStart = getCurrentWeekStart();

    // Check if we need to create a new weekly candle
    if (baseStock.weekCandles.length === 0 ||
        new Date(baseStock.weekCandles[0][0]).getTime() < currentWeekStart.getTime()) {
        // Create new candle with current price as OHLC
        baseStock.weekCandles.unshift([
            currentWeekStart.getTime(),  // Timestamp
            stockPrice.price,            // Open
            stockPrice.price,            // High
            stockPrice.price,            // Low
            stockPrice.price             // Close
        ]);
    } else {
        // Update existing candle with latest price
        baseStock.weekCandles[0][4] = stockPrice.price;  // Update close
        baseStock.weekCandles[0][2] = Math.max(baseStock.weekCandles[0][2], stockPrice.price);  // Update high
        baseStock.weekCandles[0][3] = Math.min(baseStock.weekCandles[0][3], stockPrice.price);  // Update low
    }

    // Check minimum candle requirement
    if (baseStock.weekCandles.length < settings.strategyInputs.time_frame1.lbp + 1) {
        return 0;
    }
    // Loop through the last 7 candles and calculate gains & losses
    let renkoData = calculateRenko(baseStock.weekCandles, settings.strategyInputs.brick_size, settings.strategyInputs.time_frame1.lbp);
    return  findRenkoRsi(renkoData);
}

function findDay7Rsi(baseStock, stockPrice){
    if(!baseStock.dayCandles){
        return 0;
    }
    console.log(stockPrice.name+" Day candles: "+baseStock.dayCandles.length);
    baseStock.dayCandles[0][4] = stockPrice.price;
    baseStock.dayCandles[0][2] = Math.max(baseStock.dayCandles[0][2], stockPrice.price)
    baseStock.dayCandles[0][3] = Math.min(baseStock.dayCandles[0][3], stockPrice.price);
    // Ensure we have at least 7 candles
    if (baseStock.dayCandles.length < settings.strategyInputs.time_frame2.lbp + 1) {
        return 0; // Not enough data to calculate RSI
    }
    // Loop through the last 7 candles and calculate gains & losses
    let renkoData = calculateRenko(baseStock.dayCandles, settings.strategyInputs.brick_size, settings.strategyInputs.time_frame2.lbp);
    return  findRenkoRsi(renkoData);
}

function findRenkoRsi(renkoData){
    let gains = [];
    let losses = [];
    for (let i = 0; i < renkoData.length - 1; i++) {
        let change = renkoData[i] - renkoData[i+1]; // Closing price difference
        if (change > 0) {
            gains.push(change);
        } else {
            losses.push(Math.abs(change));
        }
    }
    // Calculate average gain and average loss
    let avgGain = gains.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    let avgLoss = losses.reduce((accumulator, currentValue) => accumulator + currentValue, 0);

    // Avoid division by zero
    if (avgLoss === 0) {
        return 100; // RSI is maxed out
    }
    // Calculate RS and RSI
    let RS = avgGain / avgLoss;
    let RSI = 100 - (100 / (1 + RS));
    return RSI.toFixed(2);
}
function findMinute7rsi(baseStock, stockPrice) {
    if (!baseStock.minuteCandles || !baseStock.minuteCandles.length) {
        return 0;
    }
    if(baseStock.symbol === 'AARTIDRUGS'){
        console.log("minuteCandles len :"+baseStock.minuteCandles.length)
    }
    let currentTimestamp = Math.floor(stockPrice.ltt / 60000) * 60000; // Normalize to minute timestamp
    let lastCandle = baseStock.minuteCandles.length > 0 ? baseStock.minuteCandles[0] : null;
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
    /*if(baseStock.instrument_key === "NSE_EQ|INE155A01022"){
        console.log(baseStock.minuteCandles[0], baseStock.minuteCandles[1])
    }*/
    // Ensure we have at least 7 candles
    if (baseStock.minuteCandles.length < settings.strategyInputs.time_frame3.lbp + 1) { // We need 8 candles to calculate 7 changes
        return 0;
    }
    let renkoData = calculateRenko(baseStock.minuteCandles, settings.strategyInputs.brick_size, settings.strategyInputs.time_frame3.lbp);
    return  findRenkoRsi(renkoData);
}
function findPrevMinuteRsi(baseStock, stockPrice) {
    if (!baseStock.minuteCandles) {
        baseStock.minuteCandles = [];
    }
    if (baseStock.minuteCandles.length < settings.strategyInputs.time_frame3.lbp + 1) { // We need 8 candles to calculate 7 changes
        return 0;
    }
    const candles2rsi = [];
    const maxIndex = settings.entryConditions.pev_min_rsi_entry_threshold_look_back + settings.strategyInputs.time_frame3.lbp;
    for (let i= settings.entryConditions.pev_min_rsi_entry_threshold_look_back-1; i <  maxIndex; i++){
        candles2rsi.push(baseStock.minuteCandles[i]);
    }
    let renkoData = calculateRenko(candles2rsi, settings.strategyInputs.brick_size, settings.strategyInputs.time_frame3.lbp);
    return  findRenkoRsi(renkoData);
}

function findDay7atr(baseStock, stockPrice){
    if (!baseStock.dayCandles || baseStock.dayCandles.length < settings.strategyInputs.time_frame2.lbp + 1) {
        return 0; // Not enough data to calculate ATR
    }
    if(baseStock.symbol === 'AARTIDRUGS'){
        console.log("dayCandles len :"+baseStock.dayCandles.length)
    }
    baseStock.dayCandles[0][4] = stockPrice.price;
    baseStock.dayCandles[0][2] = Math.max(baseStock.dayCandles[0][2], stockPrice.price)
    baseStock.dayCandles[0][3] = Math.min(baseStock.dayCandles[0][3], stockPrice.price);

    let trueRanges = [];

    for (let i = 1; i <= settings.strategyInputs.time_frame2.lbp; i++) {
        let today = baseStock.dayCandles[i - 1]; // Current day's candle
        let prevClose = baseStock.dayCandles[i][4]; // Previous day's closing price

        let high = today[2]; // High of the day
        let low = today[3]; // Low of the day
        let closePrev = prevClose; // Previous day's close

        // True Range Calculation
        let tr = Math.max(
            high - low,
            Math.abs(high - closePrev),
            Math.abs(low - closePrev)
        );

        trueRanges.push(tr);
    }

    // Calculate ATR (Average of TR values)
    let atr = trueRanges.reduce((sum, val) => sum + val, 0) / settings.strategyInputs.time_frame2.lbp;
    return ((atr/stockPrice.price)*100).toFixed(2);
}
function calculateRenko(ohlcData, brickSize, lbp) {
    let renkoData = [];
    if(ohlcData.length < lbp){
        return  renkoData;
    }
    let renkoPrice = 0;
    for (let i = 0; i < lbp; i++) {
        const candle = ohlcData[i];
        let brickSizePrice = ((candle[1] + candle[2] + candle[3] + candle[4])/4) * (brickSize/100);
        brickSizePrice = Math.round(brickSizePrice.toFixed(2) * 20) / 20;
        const candleClose = ohlcData[i][4];
        if(renkoPrice === 0){
            if(Math.abs(candleClose ) >= brickSizePrice){
                renkoPrice = Math.floor(candleClose / brickSizePrice) * brickSizePrice
            }
        }else{
            if(Math.abs(candleClose - renkoPrice) >= brickSizePrice){
                renkoPrice = renkoPrice + Math.floor((candleClose - renkoPrice) / brickSizePrice) * brickSizePrice
            }
        }
        renkoData.push(renkoPrice);
    }
    return renkoData;
}

exports.setAccessToken = function (t){
    accessToken = t;
}

exports.getHistory = async function (inputStocks){
    let counter = 0;
    for (let i=0; i < inputStocks.length; i++){
        API.history(accessToken, inputStocks[i], settings.strategyInputs.time_frame1.interval, settings.strategyInputs.time_frame1.lbp).then(res => {
            inputStocks[i].weekCandles = res.data.data.candles;
        }).catch(err => {
            console.log(err.message)
        })
        API.history(accessToken, inputStocks[i], settings.strategyInputs.time_frame2.interval, settings.strategyInputs.time_frame2.lbp).then(res => {
            inputStocks[i].dayCandles = res.data.data.candles;
            API.history(accessToken, inputStocks[i], '1minute', 1).then(res => {
                inputStocks[i].minuteCandles = res.data.data.candles;
                API.intraDayCandles(accessToken, inputStocks[i]).then(res => {
                    const candles = res.data.data.candles;
                    if(candles.length){
                        let newDayCandle = [new Date().getTime(), candles[candles.length-1][1], candles[candles.length-1][2], candles[candles.length-1][3], candles[candles.length-1][4], 0];
                        for (let j=0; j < candles.length; j++){
                            newDayCandle[2] = Math.max(candles[j][2], newDayCandle[2]);
                            newDayCandle[3] = Math.min(candles[j][3], newDayCandle[3]);
                            newDayCandle[4] = candles[j][4]
                        }
                        inputStocks[i].dayCandles.unshift(newDayCandle);
                        if(inputStocks[i].dayCandles.length > settings.strategyInputs.time_frame2.lbp + 1){
                            inputStocks[i].dayCandles.splice(inputStocks[i].dayCandles.length-1 ,1);
                        }
                    }
                    inputStocks[i].minuteCandles =  res.data.data.candles.concat(inputStocks[i].minuteCandles)
                }).catch(err => {
                    console.log(err.message)
                })
            })

        }).catch(err => {
            console.log(err.message)
        })
        stocks[inputStocks[i].instrument_key] = inputStocks[i];
        if(counter >= 5){
            counter = 0;
            console.log('sleeping for 1.2 sec')
            await sleep(1200)
        }else{
            counter++;
        }
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


