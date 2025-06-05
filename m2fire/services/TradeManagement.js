"use strict";
const fs = require("fs");
const path = require("path");
const API = require("../services/UpstocksAPIService");
//const logger = require("../lib/logger");
const settings = require("../lib/Settings");
let dataPusher = null;
const DATA_PATH = path.join(__dirname, "../data/tradeData.json");
let tradeData = { orders: [], trades: [] };

function initTradeData() {
    if (fs.existsSync(DATA_PATH)) {
        tradeData = JSON.parse(fs.readFileSync(DATA_PATH));
    } else {
        saveTradeData();
    }
}

function saveTradeData() {
    fs.writeFileSync(DATA_PATH, JSON.stringify(tradeData, null, 2));
    dataPusher.pushTradeDataUpdate();
}

function findOpenOrder(stock) {
    return tradeData.orders.find(o =>
        o.instrument_token === stock.instrument_token &&
        ['OPEN', 'DRAFT'].includes(o.status)
    );
}

exports.updateOrder = function (orderData) {
    const order = tradeData.orders.find(o =>
        o.order_id === orderData.order_id
    );
    if(!order){
        return;
    }
    if(order.transaction_type === 'SELL'){
        order.sell_avg_price = orderData.average_price;
    }else{
        order.avg_price = orderData.average_price;
    }
    order.status = orderData.status.toUpperCase();
    if(order.status === 'COMPLETE'){
        completeOrCreateTrade(order)
    }
    saveTradeData();
}

function findOpenTrade(stock) {
    return tradeData.trades.find(t =>
        t.instrument_token === stock.instrument_token &&
        t.status === 'OPEN'
    );
}

function quantityToBuy(margins, stock) {
    return margins < settings.tradeSettings.PER_ORDER_VALUE
        ? 0
        : Math.floor(settings.tradeSettings.PER_ORDER_VALUE / stock.price) * 6;
}

function createOrder(stock, quantity, type = 'BUY') {
    const order = {
        id: Date.now(),
        instrument_token: stock.instrument_token,
        quantity,
        transaction_type: type,
        avg_price: stock.price,
        status: 'DRAFT',
        name: stock.name,
        order_id:''
    };
    tradeData.orders.push(order);
    saveTradeData();
    return order;
}

function createTrade(order) {
    const trade = {
        id: Date.now(),
        instrument_token: order.instrument_token,
        quantity: order.quantity,
        avg_price: order.avg_price,
        name: order.name,
        status: 'OPEN',
        created_at: new Date().toISOString()
    };
    tradeData.trades.push(trade);
    saveTradeData();
    return trade;
}

function completeTrade(order) {
    const trade = tradeData.trades.find(t =>
        t.instrument_token === order.instrument_token &&
        t.status === 'OPEN'
    );
    if (trade) {
        trade.status = 'COMPLETED';
        trade.sell_avg_price = order.sell_avg_price;
        trade.closed_at = new Date().toISOString();
        saveTradeData();
    }
}

exports.placeOrder = async function (stock, accessToken, type = 'BUY') {
    if (type === 'BUY') {
        if (findOpenOrder(stock)) throw new Error('Open order exists.');
        if (findOpenTrade(stock)) throw new Error('Trade already open.');

        const marginsResp = await API.margins(accessToken);
        console.log("Margin available : "+marginsResp.data.data.equity.available_margin)
        const marginsAvailable = marginsResp.data.data.equity.available_margin;
        const qty = quantityToBuy(marginsAvailable, stock);

        //logger.logInfo(`Qty to buy : ${qty}tch(console.log);
        if (!qty){
            throw new Error('Margin not sufficient');
        }

        const order = createOrder(stock, qty, 'BUY');
        const respOrder = await API.placeOrder({
            quantity: qty,
            product: "I",
            validity: "DAY",
            price: 0,
            tag: "string",
            instrument_token: stock.instrument_token,
            order_type: "MARKET",
            transaction_type: "BUY",
            disclosed_quantity: 0,
            trigger_price: 0,
            is_amo: false
        }, accessToken);

        order.status = 'OPEN';
        order.order_id = respOrder.data.data.order_id;
        saveTradeData();
        //logger.logInfo(`Order placed for client : ${order.order_id}`);

    } else if (type === 'SELL') {
        const openTrade = findOpenTrade(stock);
        if (!openTrade) throw new Error('No open trade exists to sell.');
        const order = createOrder(stock, openTrade.quantity, 'SELL');
        const respOrder = await API.placeOrder({
            quantity: openTrade.quantity,
            product: "I",
            validity: "DAY",
            price: 0,
            tag: "string",
            instrument_token: stock.instrument_token,
            order_type: "MARKET",
            transaction_type: "SELL",
            disclosed_quantity: 0,
            trigger_price: 0,
            is_amo: false
        }, accessToken);

        order.status = 'OPEN';
        order.order_id = respOrder.data.data.order_id;
        saveTradeData();
        //logger.logInfo(`Sell order placed for client ${client.id}: ${order.order_id}`);
    }
    return true;
};

// Call this during app start
exports.init = initTradeData;

// Call this when an order gets completed (external API callback etc.)
function completeOrCreateTrade (order) {
    if (order && order.transaction_type === 'BUY') {
        createTrade(order);
    } else if (order && order.transaction_type === 'SELL') {
        completeTrade(order);
    }
};

exports.getTradeData = function (){
    return tradeData;
};

exports.setDataPusher = function (dp){
    dataPusher = dp;
}
