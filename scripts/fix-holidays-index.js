const mongoose = require('mongoose');
require('dotenv').config();
const path = require('path');
const connectDB = require(path.join(__dirname, '../src/database/mongo'));

async function fixHolidaysIndex() {
    try {
        await connectDB();
        const db = mongoose.connection.db;
        const collection = db.collection('holidays');

        console.log('Eliminando índice restrictivo de fecha...');
        try {
            await collection.dropIndex('date_1');
            console.log('Índice date_1 eliminado.');
        } catch (e) {
            console.log('El índice date_1 no existía o ya fue eliminado.');
        }

        console.log('Creando nuevo índice compuesto (date + location)...');
        await collection.createIndex({ date: 1, location: 1 }, { unique: true });

        console.log('Índice corregido con éxito.');
        process.exit(0);
    } catch (error) {
        console.error('Error al corregir índices:', error);
        process.exit(1);
    }
}

fixHolidaysIndex();
