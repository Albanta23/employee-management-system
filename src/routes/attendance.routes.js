const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, ensureEmployeeInScope, isStoreCoordinator, getStoreLocations, getStoreEmployeeIds } = require('../utils/accessScope');

router.use(authenticateToken);

// Registrar entrada/salida/descanso
router.post('/register', async (req, res) => {
    try {
        // El registro propio es parte del portal empleado, no del coordinador.
        // Permitimos para cualquier usuario vinculado a employee_id.
        const { type, latitude, longitude, device_info, notes } = req.body;
        const employee_id = req.user.employee_id;

        if (!employee_id) {
            return res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
        }

        const attendance = new Attendance({
            employee_id,
            type,
            latitude,
            longitude,
            device_info,
            notes,
            ip_address: req.ip
        });

        await attendance.save();
        res.status(201).json({ message: 'Registro guardado correctamente', id: attendance._id });

    } catch (error) {
        console.error('Error al registrar asistencia:', error);
        res.status(500).json({ error: 'Error al registrar asistencia' });
    }
});

// Obtener estado actual (hoy)
router.get('/status', async (req, res) => {
    try {
        const employee_id = req.user.employee_id;
        if (!employee_id) return res.json({ todayStatus: 'none' });

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const lastRecord = await Attendance.findOne({
            employee_id,
            timestamp: { $gte: startOfDay }
        }).sort({ timestamp: -1 });

        res.json({
            todayStatus: lastRecord ? lastRecord.type : 'none',
            lastRecord
        });

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estado' });
    }
});

// Obtener reporte de asistencia
router.get('/report', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'attendance');
        if (!hasAccess) return;

        const { start_date, end_date, employee_id } = req.query;
        const query = {};

        if (employee_id) {
            const ok = await ensureEmployeeInScope(req, res, employee_id);
            if (!ok) return;
            query.employee_id = employee_id;
        }
        if (!employee_id && req.user.role === 'employee') {
            query.employee_id = req.user.employee_id;
        }

        if (isStoreCoordinator(req.user) && !employee_id) {
            const ids = await getStoreEmployeeIds();
            query.employee_id = { $in: ids };
        }

        if (start_date || end_date) {
            query.timestamp = {};
            if (start_date) query.timestamp.$gte = new Date(start_date);
            if (end_date) {
                const end = new Date(end_date);
                end.setHours(23, 59, 59, 999);
                query.timestamp.$lte = end;
            }
        }

        const logs = await Attendance.find(query)
            .populate('employee_id', 'full_name dni location')
            .sort({ timestamp: -1 })
            .exec();

        const formatted = logs.map(l => ({
            ...l._doc,
            id: l._id,
            full_name: l.employee_id?.full_name,
            dni: l.employee_id?.dni,
            location: l.employee_id?.location,
            employee_id: l.employee_id?._id
        }));

        res.json(formatted);

    } catch (error) {
        console.error('Error al obtener reporte:', error);
        res.status(500).json({ error: 'Error al obtener reporte' });
    }
});

module.exports = router;
