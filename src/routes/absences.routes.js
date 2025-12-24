const express = require('express');
const router = express.Router();
const Absence = require('../models/Absence');
const Vacation = require('../models/Vacation');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, ensureEmployeeInScope, isStoreCoordinator, getStoreLocations, getStoreEmployeeIds, getSettingsForAccess } = require('../utils/accessScope');

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

function parseIsoDateOrNull(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

async function hasOverlapForAbsence({ employeeId, employeeLocation, startDate, endDate, excludeAbsenceId = null }) {
    const effectiveEnd = endDate || new Date('9999-12-31T00:00:00.000Z');

    const settings = await getSettingsForAccess();
    const locationKey = String(employeeLocation || '').trim();
    const locationOverride = (settings && settings.overlap_rules_by_location && locationKey)
        ? (settings.overlap_rules_by_location instanceof Map
            ? settings.overlap_rules_by_location.get(locationKey)
            : settings.overlap_rules_by_location[locationKey])
        : null;

    const overlapRules = locationOverride || (settings && settings.overlap_rules ? settings.overlap_rules : null);
    const rule = (from, to) => {
        const fallback = true;
        if (!overlapRules || typeof overlapRules !== 'object') return fallback;
        if (!overlapRules[from] || typeof overlapRules[from] !== 'object') return fallback;
        if (!Object.prototype.hasOwnProperty.call(overlapRules[from], to)) return fallback;
        return overlapRules[from][to] !== false;
    };

    const blockAbsenceWithAbsence = rule('absence', 'absence');
    const blockAbsenceWithVacation = rule('absence', 'vacation');
    const blockAbsenceWithPermission = rule('absence', 'permission');

    const absenceQuery = {
        employee_id: employeeId,
        start_date: { $lte: effectiveEnd },
        $or: [
            { end_date: { $gte: startDate } },
            { end_date: null },
            { end_date: { $exists: false } }
        ]
    };

    if (excludeAbsenceId) {
        absenceQuery._id = { $ne: excludeAbsenceId };
    }

    // Vacaciones/permisos activos pueden bloquear una baja según reglas
    const vacationTypeOr = [];
    if (blockAbsenceWithVacation) {
        vacationTypeOr.push({ type: 'vacation' }, { type: { $exists: false } }, { type: null });
    }
    if (blockAbsenceWithPermission) {
        vacationTypeOr.push({ type: { $exists: true, $ne: 'vacation' } });
    }

    const vacationQuery = {
        employee_id: employeeId,
        status: { $in: ['pending', 'approved'] },
        start_date: { $lte: effectiveEnd },
        end_date: { $gte: startDate }
    };

    if (vacationTypeOr.length > 0) {
        vacationQuery.$or = vacationTypeOr;
    }

    const absencePromise = !blockAbsenceWithAbsence
        ? Promise.resolve(null)
        : Absence.findOne(absenceQuery).select('_id type status start_date end_date').lean();

    const vacationPromise = (vacationTypeOr.length === 0)
        ? Promise.resolve(null)
        : Vacation.findOne(vacationQuery).select('_id type status start_date end_date').lean();

    const [absenceOverlap, vacationOverlap] = await Promise.all([absencePromise, vacationPromise]);

    return { absenceOverlap, vacationOverlap };
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

        const employee = await Employee.findById(employee_id).select('location').lean();
        if (!employee) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }

        const startDate = parseIsoDateOrNull(start_date);
        const endDate = end_date ? parseIsoDateOrNull(end_date) : null;
        if (!startDate || (end_date && !endDate)) {
            return res.status(400).json({ error: 'Fechas inválidas' });
        }
        if (endDate && endDate.getTime() < startDate.getTime()) {
            return res.status(400).json({ error: 'La fecha fin no puede ser anterior a la fecha inicio' });
        }

        const overlaps = await hasOverlapForAbsence({ employeeId: employee_id, employeeLocation: employee.location, startDate, endDate });
        if (overlaps.absenceOverlap) {
            return res.status(409).json({ error: 'El rango se solapa con otra baja/ausencia existente' });
        }
        if (overlaps.vacationOverlap) {
            return res.status(409).json({ error: 'El rango se solapa con una solicitud pendiente o aprobada (vacaciones/permisos)' });
        }

        const absence = new Absence({
            employee_id,
            start_date: startDate,
            end_date: endDate,
            type,
            reason,
            medical_certificate,
            notes,
            status: 'active'
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
