"use strict";
require('dotenv').config();
var mysql = require('mysql2');
var connected = false;

exports.get = async function (sql){
    return new Promise((resolve, reject) => {
        var con = mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database:  process.env.DB_NAME,
        });
        con.connect(function(err) {
            if (err) throw err;
            con.query(sql, function (err, result) {
                if (err) reject(err)
                else resolve(result)
                con.end();
            });
        });
    })
}
exports.post = async function (tableName, data) {
    return new Promise((resolve, reject) => {
        const con = mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database:  process.env.DB_NAME,
        });
        con.connect(function(err) {
            if (err) throw err;
            // Constructing the SQL INSERT statement
            const columns = Object.keys(data).join(", ");
            const values = Object.values(data).map(value => `'${value}'`).join(", ");
            const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${values})`;

            con.query(sql, function (err, result) {
                if (err) reject(err);
                else resolve(result);
                con.end();
            });
        });
    });
}

exports.put = async function (tableName, data, keys) {
    return new Promise((resolve, reject) => {
        const con = mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database:  process.env.DB_NAME,
        });
        con.connect(function(err) {
            if (err) throw err;
            // Constructing the SQL UPDATE statement
            const setClause = Object.keys(data).map(key => {
                const value = data[key];
                return `${key} = ${typeof value === 'number' ? value : `'${value}'`}`;
            }).join(", ");
            const whereClause = Object.keys(keys).map(key => `${key} = '${keys[key]}'`).join(" AND ");
            const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;

            con.query(sql, function (err, result) {
                if (err) reject(err);
                else resolve(result);
                con.end();
            });
        });
    });
}
