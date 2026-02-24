const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const Vacation = require('../models/Vacation');
const Location = require('../models/Location');
const SchedulePublication = require('../models/SchedulePublication');
const ShiftRotationPlan = require('../models/ShiftRotationPlan');

const { authenticateToken } = require('../middleware/auth');
const {
    requireFeatureAccess,
    isAdmin,
    isStoreCoordinator,
    getStoreLocations,
    getSettingsForAccess,
} = require('../utils/accessScope');
const { calcShiftHours, suggestAdjustment, buildCalendarDays } = require('../utils/hoursEngine');
const {
    notifyShiftPublished,
    notifyShiftAssigned,
    notifyShiftUnassigned,
    notifyShiftChanged,
} = require('../utils/notificationService');

router.use(authenticateToken);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEmployee(user) {
    return !!user && user.role === 'employee';
}

function parseMonth(value, fallback = new Date().getMonth()) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 && n <= 11 ? n : fallback;
}

function parseYear(value, fallback = new Date().getFullYear()) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 2000 && n <= 2100 ? n : fallback;
}

/**
 * Comprueba que el coordinador tiene acceso al turno según tienda.
 * Devuelve true si puede, false (y responde) si no puede.
 */
async function canAccessShift(req, res, shift) {
    if (isAdmin(req.user)) return true;

    if (isStoreCoordinator(req.user)) {
        const storeLocations = await getStoreLocations();
        if (!shift.store_name || !storeLocations.includes(String(shift.store_name))) {
            res.status(403).json({ error: 'Acceso denegado a este turno' });
            return false;
        }
        return true;
    }

    res.status(403).json({ error: 'Acceso denegado' });
    return false;
}

// ─── GET /api/shifts ──────────────────────────────────────────────────────────
// Lista turnos. Admin/coord pueden filtrar por store_name y active.
router.get('/', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        const filter = {};

        if (req.query.store_name) {
            filter.store_name = req.query.store_name;
        }

        if (req.query.active !== undefined) {
            filter.active = req.query.active === 'true';
        }

        // El coordinador solo ve turnos de sus tiendas
        if (isStoreCoordinator(req.user)) {
            const storeLocations = await getStoreLocations();
            if (filter.store_name) {
                if (!storeLocations.includes(filter.store_name)) return res.json([]);
            } else {
                filter.store_name = { $in: storeLocations };
            }
        }

        const shifts = await Shift.find(filter)
            .sort({ name: 1 })
            .lean();

        res.json(shifts);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener turnos', detail: err.message });
    }
});

// ─── POST /api/shifts ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        const {
            name, color, location_id, store_name,
            weekdayStart, weekdayEnd,
            satStart, satEnd, satWeeksOff,
            openDays, targetHoursWeek, workersPerShift
        } = req.body;

        if (!name || !store_name || !weekdayStart || !weekdayEnd) {
            return res.status(400).json({ error: 'Faltan campos obligatorios: name, store_name, weekdayStart, weekdayEnd' });
        }

        const shift = await Shift.create({
            name, color, store_name,
            location_id: location_id && mongoose.Types.ObjectId.isValid(location_id) ? location_id : null,
            weekdayStart, weekdayEnd,
            satStart: satStart || '', satEnd: satEnd || '',
            satWeeksOff: Array.isArray(satWeeksOff) ? satWeeksOff : [],
            openDays: Array.isArray(openDays) ? openDays : [1,2,3,4,5],
            targetHoursWeek: targetHoursWeek || 40,
            workersPerShift: workersPerShift || 1,
        });

        res.status(201).json(shift);
    } catch (err) {
        res.status(500).json({ error: 'Error al crear turno', detail: err.message });
    }
});

// ─── GET /api/shifts/stores ───────────────────────────────────────────────────
// Devuelve la lista de tiendas disponibles.
// Admin: todas las ubicaciones (incluye fábricas).
// Coordinador: solo sus tiendas (sin fábricas).
router.get('/stores', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (isAdmin(req.user)) {
            // Admin ve exactamente lo que tiene configurado en settings.store_locations.
            // Esa lista es la fuente de verdad canónica de tiendas (sin filtro de fábrica).
            const settings = await getSettingsForAccess();
            const configured = Array.isArray(settings.store_locations) ? settings.store_locations : [];
            const clean = configured.map(l => (l == null ? '' : String(l)).trim()).filter(Boolean);

            if (clean.length > 0) {
                return res.json([...new Set(clean)].sort());
            }

            // Fallback cuando el admin aún no ha configurado la lista:
            // derivar de ubicaciones de empleados sin filtrar fábricas.
            const empLocs = await Employee.distinct('location');
            const derived = (empLocs || [])
                .map(l => (l == null ? '' : String(l)).trim())
                .filter(Boolean);
            return res.json([...new Set(derived)].sort());
        }

        // Coordinador solo ve sus tiendas (sin fábricas)
        const storeLocations = await getStoreLocations();
        res.json(storeLocations);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener tiendas', detail: err.message });
    }
});

// ─── GET /api/shifts/rotation-plan ───────────────────────────────────────────
// Devuelve el plan de rotación de un mes concreto (todos los rotativos de una tienda)
router.get('/rotation-plan', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        const month = parseMonth(req.query.month);
        const year  = parseYear(req.query.year);

        const monthStart = new Date(Date.UTC(year, month, 1));
        const monthEnd   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));

        const filter = {
            week_start: { $lte: monthEnd },
            week_end:   { $gte: monthStart }
        };

        const plans = await ShiftRotationPlan.find(filter)
            .populate('employee_id', 'full_name position location shift_id secondary_shift_id can_rotate')
            .populate('from_shift_id', 'name color')
            .populate('to_shift_id', 'name color')
            .sort({ week_start: 1 })
            .lean();

        // Si se filtra por store_name, filtrar por empleados de esa tienda
        const storeName = req.query.store_name;
        const result = storeName
            ? plans.filter(p => p.employee_id && String(p.employee_id.location) === String(storeName))
            : plans;

        res.json(result.map(p => ({
            ...p,
            id: p._id.toString(),
            _id: p._id.toString(),
        })));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener plan de rotación', detail: err.message });
    }
});

// ─── POST /api/shifts/rotation-plan ──────────────────────────────────────────
// Crea o actualiza una asignación de rotativo para una semana
router.post('/rotation-plan', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        const { employee_id, from_shift_id, to_shift_id, week_start, week_end, notes } = req.body;

        if (!employee_id || !from_shift_id || !to_shift_id || !week_start || !week_end) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        if (!mongoose.Types.ObjectId.isValid(employee_id) ||
            !mongoose.Types.ObjectId.isValid(from_shift_id) ||
            !mongoose.Types.ObjectId.isValid(to_shift_id)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        const employee = await Employee.findById(employee_id).lean();
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });
        if (!employee.can_rotate) return res.status(400).json({ error: 'Este empleado no está marcado como rotativo' });

        const weekStartDate = new Date(week_start);
        const weekEndDate   = new Date(week_end);

        if (isNaN(weekStartDate.getTime()) || isNaN(weekEndDate.getTime())) {
            return res.status(400).json({ error: 'Fechas de semana inválidas' });
        }

        // Eliminar asignación previa del mismo empleado en esa semana (si existe)
        await ShiftRotationPlan.deleteOne({
            employee_id,
            week_start: { $lte: weekEndDate },
            week_end:   { $gte: weekStartDate }
        });

        const plan = await ShiftRotationPlan.create({
            employee_id,
            from_shift_id,
            to_shift_id,
            week_start: weekStartDate,
            week_end:   weekEndDate,
            notes: notes || '',
            created_by: req.user && req.user.id ? req.user.id : null,
        });

        res.status(201).json({ id: plan._id, message: 'Asignación de rotación guardada' });
    } catch (err) {
        res.status(500).json({ error: 'Error al guardar rotación', detail: err.message });
    }
});

// ─── DELETE /api/shifts/rotation-plan/:id ────────────────────────────────────
router.delete('/rotation-plan/:planId', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.planId)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const plan = await ShiftRotationPlan.findByIdAndDelete(req.params.planId);
        if (!plan) return res.status(404).json({ error: 'Asignación no encontrada' });

        res.json({ message: 'Asignación eliminada correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar rotación', detail: err.message });
    }
});

// ─── GET /api/shifts/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        // Empleado solo puede ver su propio turno
        if (isEmployee(req.user)) {
            if (!req.user.employee_id) return res.status(403).json({ error: 'Acceso denegado' });
            const emp = await Employee.findById(req.user.employee_id).select('shift_id').lean();
            if (!emp || String(emp.shift_id) !== String(shift._id)) {
                return res.status(403).json({ error: 'Solo puedes ver tu propio turno' });
            }
        } else {
            const ok = await canAccessShift(req, res, shift);
            if (!ok) return;
        }

        res.json(shift);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener turno', detail: err.message });
    }
});

// ─── PUT /api/shifts/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id);
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const updatable = [
            'name', 'color', 'store_name',
            'weekdayStart', 'weekdayEnd',
            'satStart', 'satEnd', 'satWeeksOff',
            'openDays', 'targetHoursWeek', 'workersPerShift', 'active'
        ];

        // Detectar si hay cambios de horario para notificar a empleados
        const scheduleFields = ['weekdayStart', 'weekdayEnd', 'satStart', 'satEnd', 'satWeeksOff', 'openDays'];
        const scheduleChanged = scheduleFields.some(f => req.body[f] !== undefined && String(req.body[f]) !== String(shift[f]));

        updatable.forEach(field => {
            if (req.body[field] !== undefined) shift[field] = req.body[field];
        });

        await shift.save();

        // Notificar a empleados si cambió el horario
        if (scheduleChanged) {
            const employees = await Employee.find({ shift_id: shift._id, status: { $ne: 'inactive' } }).lean();
            if (employees.length > 0) {
                await Promise.all(employees.map(emp => notifyShiftChanged(emp, shift)));
            }
        }

        res.json(shift);
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar turno', detail: err.message });
    }
});

// ─── DELETE /api/shifts/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo el administrador puede eliminar turnos' });
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id);
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        // Desasignar todos los empleados antes de eliminar
        await Employee.updateMany({ shift_id: shift._id }, { $set: { shift_id: null } });

        await shift.deleteOne();
        res.json({ message: 'Turno eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar turno', detail: err.message });
    }
});

// ─── POST /api/shifts/:id/assign-employee ─────────────────────────────────────
router.post('/:id/assign-employee', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID de turno inválido' });
        }

        const { employee_id } = req.body;
        if (!employee_id || !mongoose.Types.ObjectId.isValid(employee_id)) {
            return res.status(400).json({ error: 'employee_id requerido y válido' });
        }

        const shift = await Shift.findById(req.params.id);
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const employee = await Employee.findById(employee_id);
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        // Detectar si estaba en otro turno
        const previousShiftId = employee.shift_id && String(employee.shift_id) !== String(shift._id)
            ? employee.shift_id : null;

        employee.shift_id = shift._id;
        await employee.save();

        await notifyShiftAssigned(employee, shift);

        res.json({
            message: `Empleado ${employee.full_name} asignado a ${shift.name}`,
            reassigned: !!previousShiftId,
            previousShiftId: previousShiftId || undefined,
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al asignar empleado', detail: err.message });
    }
});

// ─── DELETE /api/shifts/:id/employees/:empId ──────────────────────────────────
router.delete('/:id/employees/:empId', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.empId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        const shift = await Shift.findById(req.params.id);
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const employee = await Employee.findById(req.params.empId);
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        if (String(employee.shift_id) !== String(shift._id)) {
            return res.status(400).json({ error: 'El empleado no pertenece a este turno' });
        }

        employee.shift_id = null;
        await employee.save();

        await notifyShiftUnassigned(employee, shift.name);

        res.json({ message: `Empleado ${employee.full_name} desasignado del turno ${shift.name}` });
    } catch (err) {
        res.status(500).json({ error: 'Error al desasignar empleado', detail: err.message });
    }
});

// ─── GET /api/shifts/:id/employees ───────────────────────────────────────────
router.get('/:id/employees', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const employees = await Employee.find({ shift_id: shift._id })
            .select('full_name email position location status hire_date can_rotate secondary_shift_id')
            .lean();

        res.json(employees);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener empleados del turno', detail: err.message });
    }
});

// ─── GET /api/shifts/:id/coverage ────────────────────────────────────────────
// Calcula cobertura disponible del turno para un rango de fechas.
// Cuenta employeados asignados, descuenta ausentes (vacaciones+bajas) y suma rotativos.
// ?start=YYYY-MM-DD &end=YYYY-MM-DD
router.get('/:id/coverage', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const startDate = req.query.start ? new Date(req.query.start) : new Date();
        const endDate   = req.query.end   ? new Date(req.query.end)   : startDate;

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ error: 'Fechas inválidas' });
        }

        // Empleados asignados a este turno
        const allEmployees = await Employee.find({
            shift_id: shift._id,
            status: { $ne: 'inactive' }
        }).select('_id full_name can_rotate').lean();

        const totalWorkers = allEmployees.length;

        // Vacaciones/permisos aprobados o pendientes que se solapan con el rango
        const absentViaVacation = await Vacation.find({
            employee_id: { $in: allEmployees.map(e => e._id) },
            status: { $in: ['approved', 'pending'] },
            start_date: { $lte: endDate },
            end_date:   { $gte: startDate }
        }).select('employee_id start_date end_date').lean();

        // Bajas activas que se solapan
        const absentViaAbsence = await Absence.find({
            employee_id: { $in: allEmployees.map(e => e._id) },
            status: 'active',
            start_date: { $lte: endDate },
            $or: [
                { end_date: { $gte: startDate } },
                { end_date: null },
                { end_date: { $exists: false } }
            ]
        }).select('employee_id start_date end_date').lean();

        // IDs únicos de empleados ausentes en algún momento del rango
        const absentEmployeeIds = new Set([
            ...absentViaVacation.map(v => String(v.employee_id)),
            ...absentViaAbsence.map(a => String(a.employee_id))
        ]);

        // Rotativos que cubren ESTE turno (to_shift_id = shift._id) en el rango
        const rotatingIn = await ShiftRotationPlan.find({
            to_shift_id: shift._id,
            week_start: { $lte: endDate },
            week_end:   { $gte: startDate }
        }).populate('employee_id', '_id full_name').lean();

        const rotatingInCount = rotatingIn.length;

        // Rotativos de ESTE turno que se van a otro turno en el rango
        const rotatingOut = await ShiftRotationPlan.find({
            from_shift_id: shift._id,
            week_start: { $lte: endDate },
            week_end:   { $gte: startDate }
        }).populate('employee_id', '_id full_name').lean();

        // Cobertura mínima = trabajadores asignados - ausentes + rotativos que entran
        const available = totalWorkers - absentEmployeeIds.size + rotatingInCount - rotatingOut.length;

        res.json({
            shift_id:       shift._id,
            shift_name:     shift.name,
            min_workers:    shift.min_workers || 1,
            total_workers:  totalWorkers,
            absent_count:   absentEmployeeIds.size,
            rotating_in:    rotatingInCount,
            rotating_out:   rotatingOut.length,
            available:      Math.max(0, available),
            covered:        available >= (shift.min_workers || 1),
            absent_employees: [...absentEmployeeIds],
            rotating_in_employees:  rotatingIn.map(r => ({ id: r._id, name: r.employee_id?.full_name })),
            rotating_out_employees: rotatingOut.map(r => ({ id: r._id, name: r.employee_id?.full_name })),
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al calcular cobertura', detail: err.message });
    }
});

// ─── GET /api/shifts/:id/calendar ────────────────────────────────────────────
// Devuelve los días del mes con su tipo (workday, sat_work, sat_off, sunday...)
// ?month=0-11 &year=2026
router.get('/:id/calendar', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        // Empleado solo puede ver su turno
        if (isEmployee(req.user)) {
            if (!req.user.employee_id) return res.status(403).json({ error: 'Acceso denegado' });
            const emp = await Employee.findById(req.user.employee_id).select('shift_id').lean();
            if (!emp || String(emp.shift_id) !== String(shift._id)) {
                return res.status(403).json({ error: 'Solo puedes ver tu propio turno' });
            }
        } else {
            const ok = await canAccessShift(req, res, shift);
            if (!ok) return;
        }

        const month = parseMonth(req.query.month);
        const year  = parseYear(req.query.year);

        const days = buildCalendarDays(shift, year, month);

        // Añadir badge de ausencias por día
        const startDate = new Date(year, month, 1);
        const endDate   = new Date(year, month + 1, 0);

        const shiftEmployeeIds = (await Employee.find({ shift_id: shift._id }).select('_id').lean()).map(e => e._id);

        // Ausencias activas solapadas con el mes
        const absences = await Absence.find({
            employee_id: { $in: shiftEmployeeIds },
            status: 'active',
            start_date: { $lte: endDate },
            $or: [{ end_date: { $gte: startDate } }, { end_date: null }]
        }).select('employee_id start_date end_date').lean();

        // Vacaciones aprobadas solapadas con el mes
        const vacations = await Vacation.find({
            employee_id: { $in: shiftEmployeeIds },
            status: 'approved',
            start_date: { $lte: endDate },
            end_date:   { $gte: startDate }
        }).select('employee_id start_date end_date').lean();

        // Contar ausentes por día
        const absentByDay = {};
        const countAbsent = (recordList) => {
            recordList.forEach(rec => {
                const s = new Date(rec.start_date);
                const e = rec.end_date ? new Date(rec.end_date) : endDate;
                for (let d = new Date(Math.max(s, startDate)); d <= Math.min(e, endDate); d.setDate(d.getDate() + 1)) {
                    const key = d.getDate();
                    absentByDay[key] = (absentByDay[key] || 0) + 1;
                }
            });
        };
        countAbsent(absences);
        countAbsent(vacations);

        days.forEach(d => {
            d.absentCount = absentByDay[d.day] || 0;
        });

        res.json({ shift, month, year, days });
    } catch (err) {
        res.status(500).json({ error: 'Error al calcular calendario', detail: err.message });
    }
});

// ─── GET /api/shifts/:id/hours ────────────────────────────────────────────────
// Balance de horas + sugerencia de ajuste para el mes
// ?month=0-11 &year=2026
router.get('/:id/hours', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        // Empleado solo puede ver las horas de su propio turno
        if (isEmployee(req.user)) {
            if (!req.user.employee_id) return res.status(403).json({ error: 'Acceso denegado' });
            const emp = await Employee.findById(req.user.employee_id).select('shift_id').lean();
            if (!emp || String(emp.shift_id) !== String(shift._id)) {
                return res.status(403).json({ error: 'Solo puedes ver tu propio turno' });
            }
        } else {
            const allowed = await requireFeatureAccess(req, res, 'quadrants');
            if (!allowed) return;
            const ok = await canAccessShift(req, res, shift);
            if (!ok) return;
        }

        const month = parseMonth(req.query.month);
        const year  = parseYear(req.query.year);

        const hours      = calcShiftHours(shift, year, month);
        const suggestion = suggestAdjustment(shift, year, month);

        res.json({ shift, month, year, hours, suggestion });
    } catch (err) {
        res.status(500).json({ error: 'Error al calcular horas', detail: err.message });
    }
});

// ─── GET /api/shifts/:id/absence-sim ─────────────────────────────────────────
// Simulación de ausencias usando datos reales del mes (Absence + Vacation)
// ?month=0-11 &year=2026
router.get('/:id/absence-sim', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const month = parseMonth(req.query.month);
        const year  = parseYear(req.query.year);

        const startDate = new Date(year, month, 1);
        const endDate   = new Date(year, month + 1, 0);

        const employees = await Employee.find({ shift_id: shift._id, status: { $ne: 'inactive' } })
            .select('_id full_name status')
            .lean();

        const employeeIds = employees.map(e => e._id);

        // Bajas activas del mes
        const absences = await Absence.find({
            employee_id: { $in: employeeIds },
            status: 'active',
            start_date: { $lte: endDate },
            $or: [{ end_date: { $gte: startDate } }, { end_date: null }]
        }).select('employee_id start_date end_date type').lean();

        // Vacaciones aprobadas del mes
        const vacations = await Vacation.find({
            employee_id: { $in: employeeIds },
            status: 'approved',
            start_date: { $lte: endDate },
            end_date:   { $gte: startDate }
        }).select('employee_id start_date end_date type').lean();

        // Calcular días de ausencia en el mes por empleado
        function daysInRange(start, end) {
            const s = new Date(Math.max(new Date(start), startDate));
            const e = new Date(Math.min(end ? new Date(end) : endDate, endDate));
            if (s > e) return 0;
            // Contar solo días laborables (L–V, según openDays)
            let count = 0;
            const cur = new Date(s);
            while (cur <= e) {
                const dow = cur.getDay();
                if ((shift.openDays || [1,2,3,4,5]).includes(dow)) count++;
                cur.setDate(cur.getDate() + 1);
            }
            return count;
        }

        const baseHours = calcShiftHours(shift, year, month);

        const employeeSim = employees.map(emp => {
            const empAbsences  = absences.filter(a => String(a.employee_id) === String(emp._id));
            const empVacations = vacations.filter(v => String(v.employee_id) === String(emp._id));

            const absenceDays  = empAbsences.reduce((sum, a) => sum + daysInRange(a.start_date, a.end_date), 0);
            const vacationDays = empVacations.reduce((sum, v) => sum + daysInRange(v.start_date, v.end_date), 0);
            const totalAbsenceDays = absenceDays + vacationDays;

            const hours = calcShiftHours(shift, year, month, totalAbsenceDays);

            return {
                employee:       { _id: emp._id, full_name: emp.full_name, status: emp.status },
                absenceDays,
                vacationDays,
                totalAbsenceDays,
                hoursLost:      Math.round(totalAbsenceDays * baseHours.weekdayMins / 60 * 10) / 10,
                effectiveHours: Math.round(hours.effectiveMins / 60 * 10) / 10,
                absent:         totalAbsenceDays > 0,
            };
        });

        const totalAbsent    = employeeSim.filter(e => e.absent).length;
        const totalHoursLost = employeeSim.reduce((sum, e) => sum + e.hoursLost, 0);

        res.json({
            shift, month, year,
            employees: employeeSim,
            summary: {
                totalEmployees: employees.length,
                totalAbsent,
                totalHoursLost: Math.round(totalHoursLost * 10) / 10,
                coverage: employees.length > 0
                    ? Math.round(((employees.length - totalAbsent) / employees.length) * 100)
                    : 100,
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Error en simulación de ausencias', detail: err.message });
    }
});

// ─── POST /api/shifts/:id/publish ─────────────────────────────────────────────
// Publica el horario del mes: crea registro SchedulePublication + notifs in-app
router.post('/:id/publish', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const month = parseMonth(req.body.month);
        const year  = parseYear(req.body.year);

        const employees = await Employee.find({ shift_id: shift._id, status: { $ne: 'inactive' } }).lean();

        if (employees.length === 0) {
            return res.status(400).json({ error: 'El turno no tiene empleados asignados' });
        }

        // Generar snapshot del horario para auditoría
        const hoursData   = calcShiftHours(shift, year, month);
        const calendarDays = buildCalendarDays(shift, year, month);
        const snapshot = {
            shift:  { name: shift.name, weekdayStart: shift.weekdayStart, weekdayEnd: shift.weekdayEnd, satStart: shift.satStart, satEnd: shift.satEnd, satWeeksOff: shift.satWeeksOff },
            month, year,
            hours:  hoursData,
            days:   calendarDays,
        };

        // Crear registro de publicación
        const publication = await SchedulePublication.create({
            shift_id:           shift._id,
            month, year,
            sent_by:            req.user.id,
            employees_notified: employees.map(e => e._id),
            total_notified:     employees.length,
            schedule_snapshot:  snapshot,
        });

        // Crear notificaciones in-app para cada empleado
        await notifyShiftPublished(employees, shift, month, year);

        res.status(201).json({
            publicationId:      publication._id,
            employeesNotified:  employees.length,
            month, year,
            snapshot,
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al publicar horario', detail: err.message });
    }
});

// ─── GET /api/shifts/:id/publications ────────────────────────────────────────
router.get('/:id/publications', async (req, res) => {
    try {
        const allowed = await requireFeatureAccess(req, res, 'quadrants');
        if (!allowed) return;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const shift = await Shift.findById(req.params.id).lean();
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado' });

        const ok = await canAccessShift(req, res, shift);
        if (!ok) return;

        const publications = await SchedulePublication.find({ shift_id: shift._id })
            .populate('sent_by', 'name username')
            .sort({ sent_at: -1 })
            .limit(24)
            .lean();

        res.json(publications);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener publicaciones', detail: err.message });
    }
});

module.exports = router;
