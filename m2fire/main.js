// Import required modules
const UpStocksService = require('./services/UpstockService')
const express = require('express');
const cors = require('cors');
const db = require('./lib/db');
const queries = require('./lib/sqls');
// Import routes

//const LongStrategy = require('./strategies/LongStrategy');
const ShortStrategy = require('./strategies/ShortStrategy');
const TradeManagement = require('./services/TradeManagement')
const PortfolioTracker = require('./services/PortfolioTracker')

let stocks2watch = [];
let tokenCheckTimer = null;
let marketSessionStarted = false;

// Function to check current time in numeric format (e.g., 9:15 = 915)
function getCurrentTimeNumeric() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    return hours * 100 + minutes;
}

// Main initialization function
async function init() {
    try {
        const tokenResult = await db.get(queries.getQuery('access_token'));
        if (!tokenResult.length) {
            console.log("No access token found in database");
            await setupTokenCheckTimer();
            return;
        }
        if(!(await UpStocksService.isTokenValid(tokenResult[0].value))){
            console.log("Token is not valid")
            return;
        }
        const accessToken = tokenResult[0].value;
        stocks2watch  = await db.get(queries.getQuery('stocks_2_watch'));
        ShortStrategy.setAccessToken(accessToken)
        TradeManagement.init();
        ShortStrategy.initCache(TradeManagement);
        await ShortStrategy.getHistory(stocks2watch);
        await PortfolioTracker.connect(accessToken, TradeManagement)
        await UpStocksService.getMarketStream(stocks2watch, async (stockPrice) => {
            ShortStrategy.process(stockPrice);
        })
    } catch (err) {
        console.log("Initialization error:", err.message);
        //await setupTokenCheckTimer();
    }
}

// Setup timer to check for valid token before market opens
async function setupTokenCheckTimer() {
    // Clear any existing timer
    if (tokenCheckTimer) {
        clearInterval(tokenCheckTimer);
    }

    const currentTime = getCurrentTimeNumeric();

    if (currentTime < 915) {
        console.log("Current time is before 9:15 AM. Setting up token check timer.");
        // Check every minute until 9:16 (to ensure we don't miss 9:15)
        tokenCheckTimer = setInterval(async () => {
            const checkTime = getCurrentTimeNumeric();
            console.log(`Timer check: Current time is ${Math.floor(checkTime/100)}:${checkTime%100}`);
            // If it's 9:16 or later
            if (checkTime >= 916) {
                clearInterval(tokenCheckTimer);
                console.log("Time is 9:16 or later. Stopping timer.");
                // Check if we have a valid token now
                const tokenValid = await isValidAccessToken();
                if (tokenValid) {
                    console.log("Valid token found at market open. Initializing system.");
                    marketSessionStarted = true;
                    await init();
                    await run();
                } else {
                    console.log("No valid token found at 9:16. Waiting for user login.");
                }
            } else {
                // Try to get and validate token while waiting
                try {
                    const tokenResult = await db.get(queries.getQuery('access_token'));
                    if (tokenResult.length) {
                        OAUTH2.accessToken = tokenResult[0].value;
                        const isValid = await isValidAccessToken();
                        if (isValid && !marketSessionStarted) {
                            console.log("Valid token found during timer checks. Initializing system.");
                            //await init();
                            // We don't clear the timer here to allow for the 9:16 re-initialization
                        }
                    }
                } catch (err) {
                    console.log("Error checking token in timer:", err.message);
                }
            }
        }, 60000); // Check every minute
    } else {
        console.log("Current time is after 9:15 AM. Waiting for user login.");
    }
}

// Listen for access token updates from routes


// Start the initialization process
(async () => {
    await init();
})();


const { router, routerEvents, setDependencies } = require('./routes');
// Pass dependencies to routes
setDependencies({
    TradeManagement:TradeManagement,
    strategy:ShortStrategy,
});
routerEvents.on('accessTokenUpdated', async () => {
    console.log('Access token set by user.')
    init();
});
// Express App Setup
const app = express();
app.use(cors());
// Parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Use the router for all API endpoints
app.use('/', router);

// Start the server
const port = 8000;
app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});
