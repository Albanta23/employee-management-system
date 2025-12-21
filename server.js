const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const connectDB = require('./src/database/mongo');
const authRoutes = require('./src/routes/auth.routes');
const employeesRoutes = require('./src/routes/employees.routes');
const vacationsRoutes = require('./src/routes/vacations.routes');
const absencesRoutes = require('./src/routes/absences.routes');
const attendanceRoutes = require('./src/routes/attendance.routes');
const holidaysRoutes = require('./src/routes/holidays.routes');
const { getSettingsForAccess, getStoreLocations, getStoreEmployeeIds } = require('./src/utils/accessScope');

const app = express();
const PORT = process.env.PORT || 3000;

function withTimeout(promise, ms, label) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function prewarmAccessScope() {
    await getSettingsForAccess();
    await getStoreLocations();
    await getStoreEmployeeIds();
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/vacations', vacationsRoutes);
app.use('/api/absences', absencesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/settings', require('./src/routes/settings.routes'));

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('🔥 Global Error:', err);
    res.status(500).json({ error: 'Error del servidor: ' + err.message });
});

// Ruta raíz - redirigir al login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Conectar a MongoDB y arrancar servidor
// Para Vercel (serverless): solo conectar DB, no app.listen
if (process.env.VERCEL) {
    // En Vercel, conectamos la DB cuando se importa el módulo
    connectDB()
        .then(() => {
            console.log('✅ MongoDB conectado (Vercel serverless)');
        })
        .catch(err => {
            console.error('Error al conectar a MongoDB en Vercel:', err);
        });
} else {
    // En servidor tradicional: conectar y luego listen
    connectDB()
        .then(() => {
            // Prewarm (bloqueante con timeout): evita que el primer usuario pague el cold-start.
            // Si Atlas está lento, no bloqueamos indefinidamente.
            return withTimeout(prewarmAccessScope(), 20000, 'prewarm')
                .then(() => {
                    console.log('✅ Prewarm cache (scope) listo');
                })
                .catch((err) => {
                    console.warn('⚠️ Prewarm cache (scope) omitido:', err && err.message ? err.message : err);
                })
                .finally(() => {
                    app.listen(PORT, () => {
                console.log('\n========================================');
                console.log('🚀 Servidor con MongoDB iniciado');
                console.log(`📍 URL: http://localhost:${PORT}`);
                console.log('🌍 Base de Datos: MongoDB Atlas (Global)');
                console.log('========================================\n');
                    });
                });
        })
        .catch(err => {
            console.error('Error al conectar a MongoDB:', err);
            process.exit(1);
        });
}

module.exports = app;
