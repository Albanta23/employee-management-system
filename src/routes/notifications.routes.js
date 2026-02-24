const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const InAppNotification = require('../models/InAppNotification');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEmployee(user) {
    return !!user && user.role === 'employee';
}

function getEmployeeId(req) {
    return req.user && req.user.employee_id ? String(req.user.employee_id) : null;
}

// ─── GET /api/notifications ───────────────────────────────────────────────────
// Notificaciones del empleado autenticado (solo rol employee)
router.get('/', async (req, res) => {
    try {
        if (!isEmployee(req.user)) {
            return res.status(403).json({ error: 'Solo empleados pueden ver sus notificaciones' });
        }

        const employeeId = getEmployeeId(req);
        if (!employeeId) {
            return res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
        }

        const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 50);
        const offset = parseInt(req.query.offset, 10) || 0;

        const [notifications, total] = await Promise.all([
            InAppNotification.find({ employee_id: employeeId })
                .sort({ created_at: -1 })
                .skip(offset)
                .limit(limit)
                .lean(),
            InAppNotification.countDocuments({ employee_id: employeeId }),
        ]);

        res.json({ notifications, total, unreadCount: await InAppNotification.countDocuments({ employee_id: employeeId, read: false }) });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener notificaciones', detail: err.message });
    }
});

// ─── GET /api/notifications/unread-count ─────────────────────────────────────
router.get('/unread-count', async (req, res) => {
    try {
        if (!isEmployee(req.user)) {
            return res.status(403).json({ error: 'Solo empleados pueden ver sus notificaciones' });
        }

        const employeeId = getEmployeeId(req);
        if (!employeeId) {
            return res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
        }

        const count = await InAppNotification.countDocuments({ employee_id: employeeId, read: false });
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: 'Error al contar notificaciones', detail: err.message });
    }
});

// ─── PUT /api/notifications/:id/read ─────────────────────────────────────────
router.put('/:id/read', async (req, res) => {
    try {
        if (!isEmployee(req.user)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const employeeId = getEmployeeId(req);
        if (!employeeId) {
            return res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const notif = await InAppNotification.findOne({ _id: req.params.id, employee_id: employeeId });
        if (!notif) return res.status(404).json({ error: 'Notificación no encontrada' });

        if (!notif.read) {
            notif.read    = true;
            notif.read_at = new Date();
            await notif.save();
        }

        res.json(notif);
    } catch (err) {
        res.status(500).json({ error: 'Error al marcar notificación', detail: err.message });
    }
});

// ─── PUT /api/notifications/read-all ─────────────────────────────────────────
router.put('/read-all', async (req, res) => {
    try {
        if (!isEmployee(req.user)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const employeeId = getEmployeeId(req);
        if (!employeeId) {
            return res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
        }

        const result = await InAppNotification.updateMany(
            { employee_id: employeeId, read: false },
            { $set: { read: true, read_at: new Date() } }
        );

        res.json({ updated: result.modifiedCount });
    } catch (err) {
        res.status(500).json({ error: 'Error al marcar notificaciones', detail: err.message });
    }
});

module.exports = router;
