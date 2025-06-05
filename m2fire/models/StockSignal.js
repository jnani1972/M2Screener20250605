const { Model, DataTypes } = require('sequelize');
const sequelize = require('../db');

class StockSignal extends Model {}

StockSignal.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    instrument_key: {
        type: DataTypes.STRING,
        allowNull: false
    },
    signal: {
        type: DataTypes.ENUM('BUY', 'SELL'),
        allowNull: false
    },
    signal_data: {
        type: DataTypes.JSON,
        allowNull: false
    },
    at_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP')
    }
}, {
    sequelize,
    modelName: 'StockSignal',
    tableName: 'stock_signals',
    timestamps: false, // Disable automatic timestamps
    hooks: {
        beforeCreate: (stockSignal) => {
            // Force UTC timestamp if needed
            stockSignal.created_at = new Date().toISOString();
        }
    }
});

module.exports = StockSignal;
