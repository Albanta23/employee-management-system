const mongoose = require('mongoose');
require('dotenv').config();
const path = require('path');
const Holiday = require(path.join(__dirname, '../src/models/Holiday'));
const connectDB = require(path.join(__dirname, '../src/database/mongo'));

const localHolidays = [
    // --- SALAMANCA ---
    { date: '2024-06-12', name: 'San Juan de Sahagún', type: 'local', location: 'Salamanca' },
    { date: '2024-09-09', name: 'Virgen de la Vega (Traslado)', type: 'local', location: 'Salamanca' },
    { date: '2025-06-12', name: 'San Juan de Sahagún', type: 'local', location: 'Salamanca' },
    { date: '2025-09-08', name: 'Virgen de la Vega', type: 'local', location: 'Salamanca' },

    // --- ZAMORA ---
    { date: '2024-05-20', name: 'La Hiniesta', type: 'local', location: 'Zamora' },
    { date: '2024-06-29', name: 'San Pedro', type: 'local', location: 'Zamora' },
    { date: '2025-06-09', name: 'La Hiniesta', type: 'local', location: 'Zamora' },
    { date: '2025-09-08', name: 'La Concha', type: 'local', location: 'Zamora' },

    // --- VALLADOLID ---
    { date: '2024-05-13', name: 'San Pedro Regalado', type: 'local', location: 'Valladolid' },
    { date: '2024-09-09', name: 'Nuestra Señora de San Lorenzo (Traslado)', type: 'local', location: 'Valladolid' },
    { date: '2025-05-13', name: 'San Pedro Regalado', type: 'local', location: 'Valladolid' },
    { date: '2025-09-08', name: 'Nuestra Señora de San Lorenzo', type: 'local', location: 'Valladolid' },

    // --- TORO ---
    { date: '2024-05-20', name: 'La Hiniesta', type: 'local', location: 'Toro' },
    { date: '2024-08-28', name: 'San Agustín', type: 'local', location: 'Toro' },
    { date: '2025-06-09', name: 'Fiesta Local', type: 'local', location: 'Toro' },
    { date: '2025-09-08', name: 'Fiesta Local', type: 'local', location: 'Toro' }
];

async function seedLocalHolidays() {
    try {
        await connectDB();
        console.log('Insertando festivos locales...');

        for (const h of localHolidays) {
            await Holiday.findOneAndUpdate(
                { date: new Date(h.date), location: h.location },
                h,
                { upsert: true, new: true }
            );
        }

        console.log('Festivos locales insertados correctamente.');
        process.exit(0);
    } catch (error) {
        console.error('Error al insertar festivos locales:', error);
        process.exit(1);
    }
}

seedLocalHolidays();
