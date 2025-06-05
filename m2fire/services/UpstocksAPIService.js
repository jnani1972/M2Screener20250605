"use strict";
require('dotenv').config();
const axios = require('axios')
const settings = require("../lib/Settings");
exports.placeOrder = function (orderData, accessToken){
    const url = 'https://api-hft.upstox.com/v2/order/place';
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization':'Bearer '+accessToken
    }
    return axios.post(url, orderData, {headers});
}

exports.profile = async function (accessToken){
    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://api.upstox.com/v2/user/profile',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization':'Bearer '+accessToken
        }
    };
    return axios(config);
}

exports.margins = async function (accessToken){
    const url = 'https://api.upstox.com/v2/user/get-funds-and-margin';
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization':'Bearer '+accessToken
    }
    return axios.get(url, {headers});
}

exports.history = function (accessToken, it, interval, lbp) {
    const toDate = new Date();
    let fromDate = new Date();
    let daysBack = 0;
    switch (interval) {
        case 'day':
            daysBack = lbp + 1
            fromDate = findCorrectDate(fromDate ,  daysBack);
            break;
        case 'week':
            daysBack = (lbp + 1) * 7; // Past 7 weeks
            fromDate = findCorrectDate(fromDate ,  daysBack);
            break;
        case '1minute':
            daysBack = lbp;
            fromDate = findCorrectDate(fromDate ,  daysBack);
            break;
        default:
            throw new Error("Invalid interval. Use 'day', 'week', or '1minute'.");
    }
    // Adjust fromDate if current time is before market start
    const currentTime = new Date();
    if (currentTime.getHours() < settings.marketTimes.start_hour ||
        (currentTime.getHours() === settings.marketTimes.start_hour && currentTime.getMinutes() < settings.marketTimes.start_min)) {
        fromDate.setDate(fromDate.getDate() - 1);
    }
    const formattedToDate = formatDate(toDate);
    const formattedFromDate = formatDate(fromDate);
    // Ensure `it` is correctly structured
    const instrumentKey = it.instrument_key || it; // Handle if `it` is a string
    const url = `https://api.upstox.com/v2/historical-candle/${instrumentKey}/${interval}/${formattedToDate}/${formattedFromDate}`;
    let config = {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken
        }
    };
    return axios.get(url, config);
};

function findCorrectDate(fromDate, lookBack){
    const finalDates = [];
    while (finalDates.length < lookBack) {
        fromDate.setDate(fromDate.getDate() - 1);
        if(!isHoliday(fromDate)){
            finalDates.push(fromDate);
        }
    }
    return fromDate
}


exports.intraDayCandles = function (accessToken, it){
    // Ensure `it` is correctly structured
    const instrumentKey = it.instrument_key || it; // Handle if `it` is a string
    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://api.upstox.com/v2/historical-candle/intraday/${instrumentKey}/1minute`,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken
        }
    };

    return axios(config);
}

function formatDate (date) {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
    const y = date.getFullYear();
    return `${y}-${m}-${d}`;
}

function isHoliday(date) {
    return settings.holidays.some(holiday => areDatesEqual(new Date(holiday), date));
}

function areDatesEqual(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate();
}


function countHolidaysBetween(fromDate, toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);

    // Filter holidays within the given range
    const filteredHolidays = settings.holidays.filter(holiday => {
        const holidayDate = new Date(holiday);
        return holidayDate >= from && holidayDate <= to;
    });

    return filteredHolidays.length;
}

exports.exchangeAuthCodeForToken = async function (authCode) {
    const axios = require('axios');
    const qs = require('querystring');

    const data = qs.stringify({
        'code': authCode,
        'client_id': process.env.UPSTOX_API_KEY,
        'client_secret': process.env.UPSTOX_API_SECRET,
        'redirect_uri': process.env.UPSTOX_API_REDIRECT_URI,
        'grant_type': 'authorization_code'
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://api.upstox.com/v2/login/authorization/token',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        data: data
    };

    return axios(config);
}