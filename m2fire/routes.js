// routes.js
const express = require('express');
const router = express.Router();
const { Op, Utils} = require('sequelize');
const UpstocksAPI = require('./services/UpstocksAPIService');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const queries = require('./lib/sqls');
const Instrument = require('./models/Instrument');
const Stock = require('./models/Stock');
const CandleUtils = require('./strategies/CandleUtils');
const EventEmitter = require('events');
let TradeManagement = null;
require('dotenv').config();
// Create a separate event emitter rather than extending the router
const routerEvents = new EventEmitter();

// Store references to these items that will be set from main.js
let OAUTH2 = {};

db.get(queries.getQuery('access_token')).then(tokenResult => {
    if (tokenResult.length) {
        OAUTH2.accessToken = tokenResult[0].value;
    }
}).catch(err => {
    console.log('No token')
});

var Strategy = {};
// Function to set dependencies from main.js
const setDependencies = (dependencies) => {
    TradeManagement = dependencies.TradeManagement;
    Strategy = dependencies.strategy;
};

// Your auth middleware
async function authMiddleware(req, res, next) {
    const publicPaths = ['/upstox/login', '/upstox/callback', '/about'];

    if (publicPaths.includes(req.path)) {
        // Skip auth for these routes
        return next();
    }
    try { // Or whatever auth logic you're using
        await UpstocksAPI.profile(OAUTH2.accessToken)
        return next();
    }catch (err){
        res.status(401).json({ message: 'Unauthorized' });
    }
}
router.use(authMiddleware);
// Endpoint to get Upstox login URL
router.get('/upstox/login', async (req, res) => {
    try {
        const url = `https://api-v2.upstox.com/login/authorization/dialog?client_id=${process.env.UPSTOX_API_KEY}&response_type=code&redirect_uri=${process.env.UPSTOX_API_REDIRECT_URI}`;
        res.json({ url: url });
    } catch (error) {
        console.error("Error getting login URL:", error);
        res.status(500).json({ message: "Failed to get login URL" });
    }
});

// Endpoint to handle callback and retrieve access token
router.get('/upstox/callback', async (req, res) => {
    const authCode = req.query.code;
    if (!authCode) {
        return res.status(400).json({ message: "Missing authorization code" });
    }
    try {
        //Assuming you have a function to exchange authCode for accessToken
        const accessTokenRep = await UpstocksAPI.exchangeAuthCodeForToken(authCode);
        const accessToken = accessTokenRep.data.access_token;
        console.log(accessToken);
        OAUTH2.accessToken = accessToken;
        db.get(queries.getQuery('access_token')).then(async (res) => {
            if (res.length) {
               await db.put('settings', { value: accessToken }, { name: 'trading_access_token' });
            } else {
               await  db.put(queries.getQuery('insert_access_token'), [accessToken]);
            }
            routerEvents.emit('accessTokenUpdated');
        }).catch(err => {
            console.log(err.message);
        });
        res.redirect('http://localhost:3000/dashboard');
    } catch (error) {
        console.error("Error exchanging auth code for token:", error);
        res.status(500).json({ message: "Failed to retrieve access token" });
    }
});

// Endpoint to check login status
router.get('/login-status', async (req, res) => {
    res.json({ status: "success" });
});
router.get('/qstock-data', async (req, res) => {
    let stocks = Strategy.getQStocks();
    res.json(stocks['NSE_EQ|INE117A01022'].rData);
});

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        res.json({ status: "success", token: "dummy token" });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Failed to check login" });
    }
});

// Get instruments endpoint
router.get('/instruments', async (req, res) => {
    try {
        const { search, page = 1, limit = 10 } = req.query;
        const whereClause = {};

        if (search) {
            const words = search.split(/\s+/);
            whereClause[Op.and] = words.map((word) => ({
                [Op.or]: [
                    { name: { [Op.like]: `%${word}%` } },
                    { tradingsymbol: { [Op.like]: `%${word}%` } }
                ]
            }));
        }

        const instruments = await Instrument.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit)
        });

        res.json({
            status: 'success',
            data: instruments.rows,
            total: instruments.count,
            currentPage: parseInt(page),
            totalPages: Math.ceil(instruments.count / limit)
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch instruments' });
    }
});

// Get stocks endpoint
router.get('/stocks', async (req, res) => {
    try {
        const { search, filters } = req.query;

        let filtersObj = {};
        if (filters) {
            filtersObj = JSON.parse(filters);
        }

        const whereClause = {
            status: 'ACTIVE'
        };

        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { symbol: { [Op.like]: `%${search}%` } }
            ];
        }

        for (const key in filtersObj) {
            if (filtersObj[key]) {
                whereClause[key] = filtersObj[key];
            }
        }

        const stocks = await Stock.findAndCountAll({
            where: whereClause,
            attributes: ['id', 'instrument_key', 'symbol', 'name', 'price', 'status', 'change', 'cp', 'candle_data', 'ohlc', 'trading_status'],
            order: [['name', 'ASC']],
            limit: 15,
            offset: req.query.page ? (req.query.page - 1) * 15 : 0
        });

        res.json({
            status: 'success',
            data: stocks.rows,
            total: stocks.count,
            currentPage: req.query.page ? parseInt(req.query.page) : 1,
            totalPages: Math.ceil(stocks.count / 15)
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch stocks' });
    }
});

// Add stock endpoint
router.post('/add-stock', async (req, res) => {
    try {
        const { instrument_id } = req.body;

        const instrument = await Instrument.findByPk(instrument_id);
        if (!instrument) {
            return res.status(404).json({ status: 'error', message: 'Instrument not found' });
        }

        const existingStock = await Stock.findOne({
            where: { instrument_key: instrument.instrument_key }
        });

        if (existingStock) {
            return res.json({ status: 'success', message: 'Already Exists' });
        }

        await Stock.create({
            instrument_key: instrument.instrument_key,
            symbol: instrument.tradingsymbol,
            name: instrument.name,
            price: 0,
            status: 'ACTIVE'
        });

        res.json({ status: 'success', message: 'Added Successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to add stock' });
    }
});

// Remove stock endpoint
router.post('/remove-stock', async (req, res) => {
    try {
        const { stock_id } = req.body;

        const stock = await Stock.findByPk(stock_id);
        if (!stock) {
            return res.status(404).json({ status: 'error', message: 'Stock not found' });
        }

        await stock.destroy();

        res.json({ status: 'success', message: 'Removed successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to remove stock' });
    }
});

// Endpoint to read settings
router.get('/settings', async (req, res) => {
    try {
        const settingsPath = path.join(__dirname, 'settings.json');
        const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        res.json(settingsData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to read settings' });
    }
});

// Endpoint to update settings
router.post('/settings', async (req, res) => {
    try {
        const settingsPath = path.join(__dirname, 'settings.json');
        const newSettings = req.body;
        fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
        res.json({ status: 'success', message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update settings' });
    }
});
router.post('/place-order', async (req, res) => {
    try {
        const orderReqData = req.body;
        const resp = await TradeManagement.placeOrder(orderReqData, OAUTH2.accessToken, orderReqData.signal);
        res.json({ status: 'success', message: 'order placed successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});
router.get('/stock-analysis/:stockId', async (req, res) => {
    try {
        const { stockId } = req.params;
        let counter = 0;
        let stocks2watch = [];
        if (fs.existsSync("./data/stocks_data.json")) {
            stocks2watch = JSON.parse(fs.readFileSync("./data/stocks_data.json"));
        }else{
            stocks2watch = await db.get("SELECT * FROM stocks");
            for (let i=0; i<stocks2watch.length; i++){
                let stock2watch = stocks2watch[i];
                try{
                    stock2watch.candles = await CandleUtils.getHistory(stock2watch.instrument_key, OAUTH2.accessToken, 'day', 30);
                }catch (err){
                    console.error('Error:', err);
                }
                if(counter >= 5){
                    counter = 0;
                    console.log('sleeping for 1.2 sec')
                    await sleep(1200)
                }else{
                    counter++;
                }
            }
            fs.writeFileSync("./data/stocks_data.json", JSON.stringify(stocks2watch, null, 2));
        }

        res.json(stocks2watch);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { router, routerEvents, setDependencies };