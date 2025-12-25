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
        const maxPoolSizeEnv = Number(process.env.MONGO_MAX_POOL_SIZE);
        const maxPoolSize = Number.isFinite(maxPoolSizeEnv) && maxPoolSizeEnv > 0 ? maxPoolSizeEnv : 10;

        const serverSelectionTimeoutMsEnv = Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS);
        const serverSelectionTimeoutMS = Number.isFinite(serverSelectionTimeoutMsEnv) && serverSelectionTimeoutMsEnv > 0
            ? serverSelectionTimeoutMsEnv
            : 5000;

        const connectTimeoutMsEnv = Number(process.env.MONGO_CONNECT_TIMEOUT_MS);
        const connectTimeoutMS = Number.isFinite(connectTimeoutMsEnv) && connectTimeoutMsEnv > 0
            ? connectTimeoutMsEnv
            : 5000;

        const socketTimeoutMsEnv = Number(process.env.MONGO_SOCKET_TIMEOUT_MS);
        const socketTimeoutMS = Number.isFinite(socketTimeoutMsEnv) && socketTimeoutMsEnv > 0
            ? socketTimeoutMsEnv
            : 45000;

        const opts = {
            serverSelectionTimeoutMS,
            connectTimeoutMS,
            socketTimeoutMS,
            maxPoolSize
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
