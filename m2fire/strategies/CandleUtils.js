"use strict";
const settings = require("../Settings");
const API = require("../services/UpstocksAPIService");

exports.findCCPC =  function (baseStock, stockPrice){
    if (!baseStock.candles || baseStock.candles.length < settings.shortStrategyInputs.time_frame.lbp + 1) {
        return 0; // Not enough data to calculate ATR
    }
    let currentTimestamp = Math.floor(stockPrice.ltt / 60000) * 60000; // Normalize to minute timestamp
    //console.log("Total candles : "+baseStock.candles.length)
    if(settings.shortStrategyInputs.time_frame.interval === 'day'){
        //updateMinute Candle
        baseStock.candles[0][4] = stockPrice.price;
        baseStock.candles[0][2] = Math.max(baseStock.candles[0][2], stockPrice.price)
        baseStock.candles[0][3] = Math.min(baseStock.candles[0][3], stockPrice.price);
        let renkoData = calculateRenko(baseStock.candles, settings.shortStrategyInputs.brick_size, settings.shortStrategyInputs.time_frame.lbp);
        return  findRenkoSPPCNSNPC(renkoData);
    }else{
        let lastCandle = baseStock.candles[0];
        let lastCandleTimestamp = new Date(lastCandle[0]).getTime();
        if (lastCandleTimestamp !== currentTimestamp) {
            // New minute, start a new candle
            let newCandle = [currentTimestamp, stockPrice.price, stockPrice.price, stockPrice.price, stockPrice.price, 0];
            baseStock.candles.unshift(newCandle); // Add new candle at the beginning
        } else {
            // Update the existing candle
            lastCandle[2] = Math.max(lastCandle[2], stockPrice.price); // High
            lastCandle[3] = Math.min(lastCandle[3], stockPrice.price); // Low
            lastCandle[4] = stockPrice.price; // Close
        }
        let renkoData = calculateRenko(baseStock.candles, settings.shortStrategyInputs.brick_size, 300);
        return  findRenkoSPPCNSNPC(renkoData);
    }
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

function findRenkoSPPCNSNPC(renkoData){
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
    let sppc = gains.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    let snpc = losses.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    let rs = 0;
    if(snpc === 0){
        rs = 1
    }else{
        rs = sppc/snpc;
    }
    let comp1 = rs/((1+ rs) * 50);
    //Comp 2 calc
    let comp2 = 0;
    let hlbp = renkoData[0];
    let llbp = renkoData[0];
    let maxCandles2comp2 = renkoData.length > 60 ? 60 : renkoData.length;
    for (let i = 0; i < maxCandles2comp2; i++) {
        hlbp = Math.max(hlbp, renkoData[i]);
        llbp = Math.min(llbp, renkoData[i]);
    }
    comp2 = hlbp === llbp ? 0 : (2 * ((renkoData[0] - llbp)/ (hlbp - llbp))) - 1
    //PCP calc
    let pcp = ((renkoData[0] - renkoData[renkoData.length-1]) / renkoData[renkoData.length-1]) * 100;

    // ATR Calc
    for (let i = 0; i < renkoData.length; i++) {
        hlbp = Math.max(hlbp, renkoData[i]);
        llbp = Math.min(hlbp, renkoData[i]);
    }
    let atr = (hlbp - llbp / 5)
    //TRR Calc
    let trr = (atr / renkoData[0])* 100;
    //Comp 3 calc (VAC)
    let ratio = trr === 0 ? 0 : pcp/trr;
    let vac =  ratio/Math.sqrt(1 + Math.pow(ratio, 2));
    //console.log(comp1,comp2, vac);
    return  ((comp1 + comp2 + vac) / 3).toFixed(2);
}

exports.getHistory = async function (instrumentKey, accessToken, interval, lbp){
    return new Promise((resolve, reject) => {
        API.history(accessToken, instrumentKey, interval, lbp).then(res => {
            resolve(res.data.data.candles);
        }).catch(err => {
            reject(err.message)
        })
    })
}

exports.getIntraDayCandles = async function (instrumentKey, accessToken){
    return new Promise((resolve, reject) => {
        API.intraDayCandles(accessToken, instrumentKey).then(res => {
            resolve(res.data.data.candles)
        }).catch(err => {
            reject(err.message)
        })
    })
}