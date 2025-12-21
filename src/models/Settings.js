const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    company_name: {
        type: String,
        default: 'Mi Empresa'
    },
    company_address: {
        type: String,
        default: ''
    },
    company_cif: {
        type: String,
        default: ''
    },
    logo_base64: {
        type: String, // Store as base64 data URI for simplicity
        default: ''
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
});

// We only need one settings document
module.exports = mongoose.model('Settings', settingsSchema);
