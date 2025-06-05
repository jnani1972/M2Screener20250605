// models/Instrument.js
const { Model, DataTypes } = require('sequelize');
const sequelize = require('../db'); // Import your Sequelize instance

class Instrument extends Model {}

Instrument.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    tradingsymbol: {
        type: DataTypes.STRING,
        allowNull: false
    },
    instrument_key: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    sequelize,
    modelName: 'Instrument',
    tableName: 'instruments',
    timestamps: false // Set to true if you want createdAt and updatedAt fields
});

module.exports = Instrument;
