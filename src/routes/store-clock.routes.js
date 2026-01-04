const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Location = require('../models/Location');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const User = require('../models/User');

function getJwtSecret() {
    return process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY;
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDni(value) {
    return String(value || '').trim().toUpperCase();
}

function startOfDayLocal(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDayLocal(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function isAutocloseEnabled() {
    const v = process.env.ATTENDANCE_AUTOCLOSE_ENABLED;
    if (v === undefined || v === null || v === '') return true;
    return String(v).toLowerCase() === 'true' || String(v) === '1';
}

async function autoCloseForgottenOutsForEmployee(employeeId, { lookbackDays = 7 } = {}) {
    if (!isAutocloseEnabled()) return;

    const today = startOfDayLocal(new Date());

    for (let i = 1; i <= lookbackDays; i++) {
        const dayStart = new Date(today);
        dayStart.setDate(dayStart.getDate() - i);
        const dayEnd = endOfDayLocal(dayStart);

        const lastRecord = await Attendance.findOne({
            employee_id: employeeId,
            timestamp: { $gte: dayStart, $lte: dayEnd }
        }).sort({ timestamp: -1 });

        if (!lastRecord) continue;
        if (lastRecord.type === 'out') continue;

        const existingOutAfterLast = await Attendance.findOne({
            employee_id: employeeId,
            type: 'out',
            timestamp: { $gt: lastRecord.timestamp, $lte: dayEnd }
        }).sort({ timestamp: -1 });

        if (existingOutAfterLast) continue;

        const outTimestamp = new Date(Math.max(dayEnd.getTime(), lastRecord.timestamp.getTime()));

        const attendance = new Attendance({
            employee_id: employeeId,
            type: 'out',
            timestamp: outTimestamp,
            device_info: 'system-autofix',
            notes: 'AUTO: cierre de jornada por olvido (generado por el sistema)'
        });

        await attendance.save();
    }
}

async function findActiveStoreByName(storeNameRaw) {
    const storeName = String(storeNameRaw || '').trim();
    if (!storeName) return null;

    // Búsqueda case-insensitive exacta
    const rx = new RegExp(`^${escapeRegExp(storeName)}$`, 'i');

    const location = await Location.findOne({
        active: true,
        'stores.name': rx
    }).maxTimeMS(15000);

    if (!location) return null;

    const store = (location.stores || []).find(s => s && rx.test(String(s.name || '')));
    if (!store) return null;
    if (store.active === false) return null;

    return {
        locationId: String(location._id),
        storeId: String(store._id),
        storeName: String(store.name || '').trim(),
        clockPinHash: String(store.clock_pin_hash || '').trim()
    };
}

function authenticateStoreClock(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de tienda requerido' });
    }

    const secret = getJwtSecret();
    if (!secret) {
        return res.status(500).json({ error: 'Configuración del servidor incompleta (JWT_SECRET)' });
    }

    jwt.verify(token, secret, (err, decoded) => {
        const storeName = decoded && decoded.storeName ? String(decoded.storeName) : '';

        // Admitimos dos formatos:
        // 1) Token específico: { purpose: 'store-clock', storeName }
        // 2) Token de login unificado: { role: 'store_clock', storeName }
        const ok = !err && decoded && storeName && (
            decoded.purpose === 'store-clock' || decoded.role === 'store_clock'
        );

        if (!ok) {
            return res.status(403).json({ error: 'Token de tienda inválido' });
        }

        req.storeClock = { storeName };
        next();
    });
}

// POST /api/store-clock/login
// Body: { storeName, pin }
router.post('/login', async (req, res) => {
    try {
        const secret = getJwtSecret();
        if (!secret) {
            return res.status(500).json({
                error: 'Configuración del servidor incompleta (JWT_SECRET)'
            });
        }

        const { storeName, pin } = req.body || {};
        if (!storeName || !String(storeName).trim() || !pin || !String(pin).trim()) {
            return res.status(400).json({ error: 'Nombre de tienda y PIN requeridos' });
        }

        const store = await findActiveStoreByName(storeName);
        if (!store) {
            return res.status(401).json({ error: 'Tienda o PIN inválidos' });
        }

        if (!store.clockPinHash) {
            return res.status(401).json({ error: 'Tienda o PIN inválidos' });
        }

        const ok = await bcrypt.compare(String(pin), store.clockPinHash);
        if (!ok) {
            return res.status(401).json({ error: 'Tienda o PIN inválidos' });
        }

        const token = jwt.sign(
            { purpose: 'store-clock', storeName: store.storeName },
            secret,
            { expiresIn: '24h' }
        );

        res.json({ token, storeName: store.storeName });
    } catch (error) {
        console.error('Error en store-clock/login:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// GET /api/store-clock/employees
router.get('/employees', authenticateStoreClock, async (req, res) => {
    try {
        const storeName = req.storeClock.storeName;
        const employees = await Employee.find({
            status: 'active',
            location: storeName
        })
            .select('_id full_name dni')
            .sort({ full_name: 1 })
            .lean()
            .maxTimeMS(15000);

        const formatted = (employees || []).map(e => ({
            id: String(e._id),
            _id: String(e._id),
            full_name: e.full_name,
            dni: e.dni
        }));

        res.json({ employees: formatted });
    } catch (error) {
        console.error('Error en store-clock/employees:', error);
        res.status(500).json({ error: 'Error al obtener empleados' });
    }
});

// POST /api/store-clock/punch
// Body: { dni, code }
router.post('/punch', authenticateStoreClock, async (req, res) => {
    try {
        const storeName = req.storeClock.storeName;
        const { dni, code, latitude, longitude } = req.body || {};

        const normalizedDni = normalizeDni(dni);
        const rawCode = String(code || '').trim();

        if (!normalizedDni || !rawCode) {
            return res.status(400).json({ error: 'DNI y código requeridos' });
        }

        const employee = await Employee.findOne({
            dni: normalizedDni,
            location: storeName,
            status: 'active'
        }).select('_id full_name dni location').maxTimeMS(15000);

        if (!employee) {
            return res.status(404).json({ error: 'Empleado no encontrado en esta tienda' });
        }

        const user = await User.findOne({
            username: normalizedDni,
            role: 'employee'
        }).select('password mustChangePassword employee_id').maxTimeMS(15000);

        if (!user) {
            return res.status(401).json({ error: 'Código inválido' });
        }

        if (user.mustChangePassword) {
            return res.status(403).json({ error: 'El empleado debe cambiar su código de acceso antes de fichar' });
        }

        const ok = await bcrypt.compare(rawCode, user.password);
        if (!ok) {
            return res.status(401).json({ error: 'Código inválido' });
        }

        // Autocierre de días pasados para evitar que un IN de ayer afecte al toggle
        await autoCloseForgottenOutsForEmployee(employee._id);

        const startToday = startOfDayLocal(new Date());
        const lastToday = await Attendance.findOne({
            employee_id: employee._id,
            timestamp: { $gte: startToday }
        }).sort({ timestamp: -1 }).lean().maxTimeMS(15000);

        const nextType = (!lastToday || lastToday.type === 'out') ? 'in' : 'out';

        const attendance = new Attendance({
            employee_id: employee._id,
            type: nextType,
            store_name: storeName,
            latitude: (latitude === undefined || latitude === null || latitude === '') ? undefined : Number(latitude),
            longitude: (longitude === undefined || longitude === null || longitude === '') ? undefined : Number(longitude),
            device_info: 'store-tablet',
            notes: `Portal tienda: ${storeName}`,
            ip_address: req.ip
        });

        await attendance.save();

        res.status(201).json({
            message: 'Fichaje registrado',
            type: nextType,
            timestamp: attendance.timestamp,
            employee: {
                id: String(employee._id),
                full_name: employee.full_name,
                dni: employee.dni,
                location: employee.location
            }
        });
    } catch (error) {
        console.error('Error en store-clock/punch:', error);
        res.status(500).json({ error: 'Error al registrar el fichaje' });
    }
});

module.exports = router;
