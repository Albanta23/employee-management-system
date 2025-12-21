const mongoose = require('mongoose');
require('dotenv').config();
const path = require('path');
const Holiday = require(path.join(__dirname, '../src/models/Holiday'));
const connectDB = require(path.join(__dirname, '../src/database/mongo'));

const nationalHolidays = [
    { date: '2024-01-01', name: 'Año Nuevo', type: 'national' },
    { date: '2024-01-06', name: 'Epifanía del Señor', type: 'national' },
    { date: '2024-03-29', name: 'Viernes Santo', type: 'national' },
    { date: '2024-05-01', name: 'Fiesta del Trabajo', type: 'national' },
    { date: '2024-08-15', name: 'Asunción de la Virgen', type: 'national' },
    { date: '2024-10-12', name: 'Fiesta Nacional de España', type: 'national' },
    { date: '2024-11-01', name: 'Todos los Santos', type: 'national' },
    { date: '2024-12-06', name: 'Día de la Constitución Española', type: 'national' },
    { date: '2024-12-08', name: 'Inmaculada Concepción', type: 'national' },
    { date: '2024-12-25', name: 'Natividad del Señor', type: 'national' },
    // 2025
    { date: '2025-01-01', name: 'Año Nuevo', type: 'national' },
    { date: '2025-01-06', name: 'Epifanía del Señor', type: 'national' },
    { date: '2025-04-18', name: 'Viernes Santo', type: 'national' },
    { date: '2025-05-01', name: 'Fiesta del Trabajo', type: 'national' },
    { date: '2025-08-15', name: 'Asunción de la Virgen', type: 'national' },
    { date: '2025-10-12', name: 'Fiesta Nacional de España', type: 'national' },
    { date: '2025-11-01', name: 'Todos los Santos', type: 'national' },
    { date: '2025-12-06', name: 'Día de la Constitución Española', type: 'national' },
    { date: '2025-12-08', name: 'Inmaculada Concepción', type: 'national' },
    { date: '2025-12-25', name: 'Natividad del Señor', type: 'national' },
    // 2026
    { date: '2026-01-01', name: 'Año Nuevo', type: 'national' },
    { date: '2026-01-06', name: 'Epifanía del Señor', type: 'national' },
    { date: '2026-04-03', name: 'Viernes Santo', type: 'national' },
    { date: '2026-05-01', name: 'Fiesta del Trabajo', type: 'national' },
    { date: '2026-08-15', name: 'Asunción de la Virgen', type: 'national' },
    { date: '2026-10-12', name: 'Fiesta Nacional de España', type: 'national' },
    { date: '2026-11-01', name: 'Todos los Santos', type: 'national' },
    { date: '2026-12-06', name: 'Día de la Constitución Española', type: 'national' },
    { date: '2026-12-08', name: 'Inmaculada Concepción', type: 'national' },
    { date: '2026-12-25', name: 'Natividad del Señor', type: 'national' },
];

async function seedHolidays() {
    try {
        await connectDB();
        console.log('Insertando festivos nacionales...');

        for (const h of nationalHolidays) {
            await Holiday.findOneAndUpdate(
                { date: new Date(h.date) },
                h,
                { upsert: true, new: true }
            );
        }

        console.log('Festivos nacionales insertados correctamente.');
        process.exit(0);
    } catch (error) {
        console.error('Error al insertar festivos:', error);
        process.exit(1);
    }
}

seedHolidays();
