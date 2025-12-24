const express = require('express');
const mongoose = require('mongoose');

const connectDB = require('../database/mongo');

const router = express.Router();

function readyStateLabel(state) {
    // https://mongoosejs.com/docs/api/connection.html#Connection.prototype.readyState
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    if (state === 1) return 'connected';
    if (state === 2) return 'connecting';
    if (state === 3) return 'disconnecting';
    return 'disconnected';
}

router.get('/', async (req, res) => {
    const startedAt = process.uptime();
    const initialState = mongoose.connection ? mongoose.connection.readyState : 0;

    // Intento “suave” de asegurar conexión. Si no hay URI o falla, marcamos degraded.
    let dbOk = false;
    let dbError;
    try {
        await connectDB();
        dbOk = (mongoose.connection && mongoose.connection.readyState === 1);
    } catch (e) {
        dbOk = false;
        dbError = e && e.message ? e.message : String(e);
    }

    const state = mongoose.connection ? mongoose.connection.readyState : 0;

    const payload = {
        ok: dbOk,
        service: 'employee-management-system',
        env: process.env.NODE_ENV || 'unknown',
        time: new Date().toISOString(),
        uptimeSeconds: Math.floor(startedAt),
        db: {
            provider: 'mongodb',
            readyState: state,
            status: readyStateLabel(state),
            ok: dbOk
        }
    };

    if (!dbOk && dbError) {
        payload.db.error = dbError;
    }

    res.status(dbOk ? 200 : 503).json(payload);
});

module.exports = router;
