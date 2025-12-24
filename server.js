const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const connectDB = require('./src/database/mongo');
const logger = require('./src/utils/logger');
const authRoutes = require('./src/routes/auth.routes');
const employeesRoutes = require('./src/routes/employees.routes');
const vacationsRoutes = require('./src/routes/vacations.routes');
const absencesRoutes = require('./src/routes/absences.routes');
const attendanceRoutes = require('./src/routes/attendance.routes');
const holidaysRoutes = require('./src/routes/holidays.routes');
const { getSettingsForAccess, getStoreLocations, getStoreEmployeeIds } = require('./src/utils/accessScope');

const app = express();
const PORT = process.env.PORT || 3000;

// Promesa de conexión para Vercel (serverless)
let dbConnectionPromise = null;

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

// Request logging (JSON, sin datos sensibles)
app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || logger.generateRequestId();
    const start = Date.now();

    res.on('finish', () => {
        const durationMs = Date.now() - start;
        const userId = req.user && (req.user.id || req.user._id) ? String(req.user.id || req.user._id) : undefined;
        const role = req.user && req.user.role ? String(req.user.role) : undefined;
        logger.info('http_request', {
            requestId: String(req.requestId),
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs,
            ip: req.ip,
            userId,
            role
        });
    });

    next();
});

// Healthcheck (no requiere auth)
app.use('/health', require('./src/routes/health.routes'));

// Middleware para asegurar conexión a MongoDB en Vercel (serverless)
app.use('/api', async (req, res, next) => {
    try {
        if (!dbConnectionPromise) {
            dbConnectionPromise = connectDB();
        }
        await dbConnectionPromise;
        next();
    } catch (error) {
        logger.error('db_connection_error', {
            requestId: String(req.requestId || ''),
            error: error && error.message ? error.message : String(error)
        });
        res.status(503).json({ error: 'Error de conexión a la base de datos', requestId: req.requestId });
    }
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/vacations', vacationsRoutes);
app.use('/api/absences', absencesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/settings', require('./src/routes/settings.routes'));
app.use('/api/locations', require('./src/routes/locations.routes'));
app.use('/api/audit', require('./src/routes/audit.routes'));
app.use('/api/reports', require('./src/routes/reports.routes'));

// Global Error Handler
app.use((err, req, res, next) => {
    logger.error('unhandled_error', {
        requestId: String(req.requestId || ''),
        error: err && err.message ? err.message : String(err),
        stack: err && err.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : undefined
    });
    res.status(500).json({ error: 'Error del servidor', requestId: req.requestId });
});

// Ruta raíz - redirigir al login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Conectar a MongoDB y arrancar servidor
// - En Vercel (serverless): la conexión se hace mediante middleware antes de cada request API
// - En ejecución local: solo hacemos listen si este fichero es el entrypoint
if (process.env.VERCEL) {
    logger.info('vercel_serverless_mode', {});
} else if (require.main === module) {
    connectDB()
        .then(() => {
            return withTimeout(prewarmAccessScope(), 20000, 'prewarm')
                .then(() => {
                    console.log('✅ Prewarm cache (scope) listo');
                })
                .catch((err) => {
                    console.warn('⚠️ Prewarm cache (scope) omitido:', err && err.message ? err.message : err);
                })
                .finally(() => {
                    app.listen(PORT, () => {
                        logger.info('server_started', { port: Number(PORT) });
                    });
                });
        })
        .catch(err => {
            logger.error('startup_db_connection_error', { error: err && err.message ? err.message : String(err) });
            process.exit(1);
        });
}

// Captura de errores a nivel de proceso
process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { error: reason && reason.message ? reason.message : String(reason) });
});

process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { error: err && err.message ? err.message : String(err) });
    if (!process.env.VERCEL) {
        process.exit(1);
    }
});

module.exports = app;
