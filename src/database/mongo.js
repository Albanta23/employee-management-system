const mongoose = require('mongoose');
require('dotenv').config();

// Evita que Mongoose deje peticiones "en cola" indefinidamente si se pierde la conexión.
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 5000);

// Cache de conexión para serverless (Vercel)
let cached = global.mongoose;
if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
    // Si ya hay conexión, reutilizarla
    if (cached.conn) {
        return cached.conn;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI no está definida en las variables de entorno');
    }

    if (!cached.promise) {
        const opts = {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10
        };

        cached.promise = mongoose.connect(process.env.MONGODB_URI, opts)
            .then((mongoose) => {
                console.log(`✓ MongoDB Conectado: ${mongoose.connection.host} (db: ${mongoose.connection.name})`);
                return mongoose;
            });
    }

    try {
        cached.conn = await cached.promise;
    } catch (error) {
        cached.promise = null;
        console.error(`Error al conectar a MongoDB: ${error.message}`);
        // En Vercel no hacer process.exit, lanzar el error
        if (process.env.VERCEL) {
            throw error;
        }
        process.exit(1);
    }

    return cached.conn;
};

module.exports = connectDB;
