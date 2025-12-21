const mongoose = require('mongoose');
require('dotenv').config();
const Settings = require('./src/models/Settings');
const connectDB = require('./src/database/mongo');

async function checkSettings() {
    try {
        await connectDB();
        const settings = await Settings.findOne();
        console.log('Current Settings:', settings);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkSettings();
