const express = require('express');
const router = express.Router();
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, ensureEmployeeInScope, isStoreCoordinator, getStoreLocations, getStoreEmployeeIds } = require('../utils/accessScope');

router.use(authenticateToken);

function parseYear(value) {
    const year = Number.parseInt(String(value || ''), 10);
    const nowYear = new Date().getFullYear();
    if (!Number.isFinite(year)) return nowYear;
    if (year < 1970 || year > 3000) return nowYear;
    return year;
}

function toUtcDateOnly(d) {
    const date = new Date(d);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function calendarDaysInclusive(startDate, endDate) {
    if (!startDate) return 0;
    const startUtc = toUtcDateOnly(startDate);
    const endUtc = toUtcDateOnly(endDate || new Date());
    if (endUtc < startUtc) return 0;
    const diffDays = Math.floor((endUtc - startUtc) / (1000 * 60 * 60 * 24));
    return diffDays + 1;
}

// Resumen de ausencias (por año). Útil para control de días de bajas/ausencias.
router.get('/summary', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'absences');
        if (!hasAccess) return;

        const { employee_id } = req.query;
        const year = parseYear(req.query.year);
        const rangeStart = new Date(`${year}-01-01T00:00:00.000Z`);
        const rangeEnd = new Date(`${year}-12-31T23:59:59.999Z`);

        const query = {
            start_date: { $lte: rangeEnd },
            $or: [
                { end_date: { $gte: rangeStart } },
                { end_date: null },
                { end_date: { $exists: false } }
            ]
        };

        if (employee_id) {
            const ok = await ensureEmployeeInScope(req, res, employee_id);
            if (!ok) return;
            query.employee_id = employee_id;
        } else if (isStoreCoordinator(req.user)) {
            const ids = await getStoreEmployeeIds();
            query.employee_id = { $in: ids };
        }

        const items = await Absence.find(query).lean();

        let totalDays = 0;
        let activeCount = 0;
        let closedCount = 0;
        const byType = {};

        for (const a of items) {
            const status = a.status || 'active';
            if (status === 'active') activeCount++;
            if (status === 'closed') closedCount++;

            const overlapStart = new Date(Math.max(new Date(a.start_date).getTime(), rangeStart.getTime()));
            const rawEnd = a.end_date ? new Date(a.end_date) : new Date();
            const overlapEnd = new Date(Math.min(rawEnd.getTime(), rangeEnd.getTime()));

            const days = calendarDaysInclusive(overlapStart, overlapEnd);
            totalDays += days;

            const type = a.type || 'other';
            byType[type] = (byType[type] || 0) + days;
        }

        res.json({
            year,
            employee_id: employee_id ? String(employee_id) : null,
            total_records: items.length,
            active_records: activeCount,
            closed_records: closedCount,
            total_days: totalDays,
            days_by_type: byType
        });
    } catch (error) {
        console.error('Error al obtener resumen de ausencias:', error);
        res.status(500).json({ error: 'Error al obtener resumen de ausencias' });
    }
});

// Obtener todas las bajas
router.get('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'absences');
        if (!hasAccess) return;

        const { employee_id, status, type } = req.query;
        const query = {};

        if (employee_id) {
            const ok = await ensureEmployeeInScope(req, res, employee_id);
            if (!ok) return;
            query.employee_id = employee_id;
        }
        if (status) query.status = status;
        if (type) query.type = type;

        if (isStoreCoordinator(req.user) && !employee_id) {
            const ids = await getStoreEmployeeIds();
            query.employee_id = { $in: ids };
        }

        const absences = await Absence.find(query)
            .populate('employee_id', 'full_name dni position location')
            .sort({ start_date: -1 })
            .lean()
            .exec();

        const formatted = absences.map(a => ({
            ...a,
            id: a._id.toString(),
            _id: a._id.toString(),
            full_name: a.employee_id?.full_name,
            dni: a.employee_id?.dni,
            position: a.employee_id?.position,
            location: a.employee_id?.location,
            employee_id: a.employee_id?._id.toString()
        }));

        res.json(formatted);

    } catch (error) {
        console.error('Error al obtener bajas:', error);
        res.status(500).json({ error: 'Error al obtener bajas' });
    }
});

// Registrar una baja
router.post('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'absences');
        if (!hasAccess) return;

        const { employee_id, start_date, end_date, type, reason, medical_certificate, notes } = req.body;

        if (!employee_id || !start_date || !type) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const ok = await ensureEmployeeInScope(req, res, employee_id);
        if (!ok) return;

        const absence = new Absence({
            employee_id, start_date, end_date, type, reason, medical_certificate, notes, status: 'active'
        });

        await absence.save();

        // Si es una baja activa, actualizar el estado del empleado opcionalmente
        // await Employee.findByIdAndUpdate(employee_id, { status: 'on_leave' });

        res.status(201).json({ id: absence._id, message: 'Baja registrada correctamente' });

    } catch (error) {
        console.error('Error al registrar baja:', error);
        res.status(500).json({ error: 'Error al registrar baja' });
    }
});

// Finalizar una baja
router.put('/:id/close', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'absences');
        if (!hasAccess) return;

        const { end_date } = req.body;

        const existing = await Absence.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Baja no encontrada' });

        const ok = await ensureEmployeeInScope(req, res, existing.employee_id);
        if (!ok) return;

        const absence = await Absence.findByIdAndUpdate(req.params.id, {
            status: 'closed',
            end_date: end_date || new Date()
        }, { new: true });

        if (!absence) return res.status(404).json({ error: 'Baja no encontrada' });
        res.json({ message: 'Baja finalizada correctamente' });

    } catch (error) {
        res.status(500).json({ error: 'Error al finalizar baja' });
    }
});

// Eliminar registro
router.delete('/:id', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'absences');
        if (!hasAccess) return;

        const existing = await Absence.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Baja no encontrada' });

        const ok = await ensureEmployeeInScope(req, res, existing.employee_id);
        if (!ok) return;

        await Absence.findByIdAndDelete(req.params.id);
        res.json({ message: 'Registro eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar baja' });
    }
});

module.exports = router;
