const mongoose = require('mongoose');
require('dotenv').config();

// Evita que Mongoose deje peticiones "en cola" indefinidamente si se pierde la conexión.
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 5000);

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10
        });
        console.log(`✓ MongoDB Conectado: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error al conectar a MongoDB: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
