"use strict";
const { MongoClient } = require('mongodb');

let mongoClient;
let mongoDb;

async function connectMongo() {
    if (!mongoClient) {
        mongoClient = new MongoClient('mongodb://localhost:27017'); // Removed useNewUrlParser
        await mongoClient.connect();
        mongoDb = mongoClient.db('m2_logs'); // Change to your desired database name
    }
}

exports.logInfo = async function (message) {
    await connectMongo();
    const logsCollection = mongoDb.collection('ex_logs'); // Change to your desired collection name
    await logsCollection.insertOne({ level: 'info', message, timestamp: new Date() });
};

exports.logWarning = async function (message) {
    await connectMongo();
    const logsCollection = mongoDb.collection('ex_logs');
    await logsCollection.insertOne({ level: 'warning', message, timestamp: new Date() });
};

exports.logError = async function (message) {
    await connectMongo();
    const logsCollection = mongoDb.collection('ex_logs');
    await logsCollection.insertOne({ level: 'error', message, timestamp: new Date() });
};
