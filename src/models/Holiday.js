const mongoose = require('mongoose');

const HolidaySchema = new mongoose.Schema({
    date: { type: Date, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['national', 'local'], required: true },
    location: { type: String } // Si es local, a qué tienda/ubicación aplica. Si es national, vacío.
}, { timestamps: true });

module.exports = mongoose.model('Holiday', HolidaySchema);
