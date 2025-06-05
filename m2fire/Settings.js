const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '/settings.json');
const loadSettings = () => {
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (error) {
        console.error('Error loading settings:', error);
        return null;
    }
};

module.exports = loadSettings();