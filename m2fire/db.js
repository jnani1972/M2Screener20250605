require('dotenv').config(); // Load environment variables from .env file

const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME,    // Database name
    process.env.DB_USER,    // Database username
    process.env.DB_PASSWORD, // Database password
    {
        host: process.env.DB_HOST,  // Database host
        dialect: process.env.DB_DIALECT // Database dialect (e.g., mysql)
    }
);

module.exports = sequelize;
