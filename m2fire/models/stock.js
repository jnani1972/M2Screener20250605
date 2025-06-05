// models/Stock.js
const { Model, DataTypes } = require('sequelize');
const sequelize = require('../db'); // Import your Sequelize instance

class Stock extends Model {}

Stock.init({
    instrument_key: {
        type: DataTypes.STRING,
        allowNull: false
    },
    symbol: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        allowNull: true
    },
    change: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    cp: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    candle_data: {
        type: DataTypes.JSON,
        allowNull: true
    },
    ohlc: {
        type: DataTypes.JSON,
        allowNull: true
    },
    trading_status: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    sequelize,
    modelName: 'Stock',
    tableName: 'stocks',
    timestamps: false // Set to true if you want createdAt and updatedAt fields
});

module.exports = Stock;
