const express = require('express');
const router = express.Router();
const MonthlySchedule = require('../models/MonthlySchedule');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const Vacation = require('../models/Vacation');
const Absence = require('../models/Absence');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, isStoreCoordinator, getStoreLocations } = require('../utils/accessScope');

router.use(authenticateToken);

// Devuelve el nº de días del mes (1-based)
function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate(); // month es 0-based
}

// Transforma una fecha a "día del mes" (UTC) si pertenece a year/month, o null
function dayOfMonthUtc(date, year, month) {
    const d = new Date(date);
    if (d.getUTCFullYear() !== year) return null;
    if (d.getUTCMonth() !== month) return null;
    return d.getUTCDate();
}

// Devuelve array de días [1..daysInMonth] que están dentro de [rangeStart, rangeEnd] (UTC)
function daysInRange(rangeStart, rangeEnd, year, month) {
    const total = daysInMonth(year, month);
    const days = [];
    for (let d = 1; d <= total; d++) {
        const dayDate = Date.UTC(year, month, d);
        if (dayDate >= rangeStart.getTime() && dayDate <= rangeEnd.getTime()) {
            days.push(d);
        }
    }
    return days;
}

// Range del mes completo en UTC
function monthRange(year, month) {
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const end   = new Date(Date.UTC(year, month, daysInMonth(year, month), 23, 59, 59, 999));
    return { start, end };
}

// ─── GET /api/schedules ─────────────────────────────────────────────────────
// Devuelve la cuadrícula con overlay V/B y cobertura por día
router.get('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'shifts');
        if (!hasAccess) return;

        const { store_name, month, year } = req.query;
        if (!store_name || month === undefined || year === undefined) {
            return res.status(400).json({ error: 'Faltan parámetros: store_name, month, year' });
        }

        const y = parseInt(year, 10);
        const m = parseInt(month, 10); // 0-based

        const schedule = await MonthlySchedule.findOne({ store_name, year: y, month: m }).lean();
        // Si no existe, devolvemos null con 200 (el frontend creará una nueva)
        if (!schedule) {
            return res.json(null);
        }

        const { start, end } = monthRange(y, m);

        // Empleados activos de la tienda para poder hacer el overlay
        const employees = await Employee.find({ location: store_name, status: 'active' })
            .select('_id full_name shift_id')
            .lean();
        const empIds = employees.map(e => e._id);

        // Vacaciones aprobadas/pendientes que solapan con el mes
        const vacations = await Vacation.find({
            employee_id: { $in: empIds },
            status: { $in: ['approved', 'pending'] },
            start_date: { $lte: end },
            end_date:   { $gte: start }
        }).select('employee_id start_date end_date').lean();

        // Bajas activas que solapan con el mes
        const absences = await Absence.find({
            employee_id: { $in: empIds },
            $or: [
                { end_date: { $gte: start } },
                { end_date: null },
                { end_date: { $exists: false } }
            ],
            start_date: { $lte: end }
        }).select('employee_id start_date end_date status').lean();

        const total = daysInMonth(y, m);

        // Mapas para lookup rápido: empId → Set<day>
        const vacMap = {};
        const absMap = {};

        for (const v of vacations) {
            const eid = v.employee_id.toString();
            if (!vacMap[eid]) vacMap[eid] = new Set();
            const vStart = new Date(Math.max(new Date(v.start_date).getTime(), start.getTime()));
            const vEnd   = new Date(Math.min(new Date(v.end_date).getTime(), end.getTime()));
            for (let d = new Date(vStart); d <= vEnd; d.setUTCDate(d.getUTCDate() + 1)) {
                if (d.getUTCFullYear() === y && d.getUTCMonth() === m) {
                    vacMap[eid].add(d.getUTCDate());
                }
            }
        }

        for (const a of absences) {
            const eid = a.employee_id.toString();
            if (!absMap[eid]) absMap[eid] = new Set();
            const aStart = new Date(Math.max(new Date(a.start_date).getTime(), start.getTime()));
            const rawEnd = a.end_date ? new Date(a.end_date) : end;
            const aEnd   = new Date(Math.min(rawEnd.getTime(), end.getTime()));
            for (let d = new Date(aStart); d <= aEnd; d.setUTCDate(d.getUTCDate() + 1)) {
                if (d.getUTCFullYear() === y && d.getUTCMonth() === m) {
                    absMap[eid].add(d.getUTCDate());
                }
            }
        }

        // Aplicar overlay sobre los assignments guardados
        const assignmentMap = {};
        for (const a of schedule.assignments) {
            const eid = a.employee_id.toString();
            if (!assignmentMap[eid]) assignmentMap[eid] = {};
            assignmentMap[eid][a.day] = a.slot;
        }

        const overlaidAssignments = schedule.assignments.map(a => {
            const eid = a.employee_id.toString();
            let slot = a.slot;
            if (vacMap[eid] && vacMap[eid].has(a.day)) slot = 'V';
            else if (absMap[eid] && absMap[eid].has(a.day)) slot = 'B';
            return { employee_id: eid, day: a.day, slot };
        });

        // Calcular cobertura por día: contar M y T (no V, B, L ni tarde cerrada)
        const closedSet = new Set(schedule.closed_afternoons || []);
        const coverage = {};
        for (let d = 1; d <= total; d++) {
            coverage[d] = { morning: 0, afternoon: 0 };
        }
        for (const a of overlaidAssignments) {
            if (a.slot === 'M') coverage[a.day].morning++;
            else if (a.slot === 'T' && !closedSet.has(a.day)) coverage[a.day].afternoon++;
        }

        res.json({
            ...schedule,
            assignments: overlaidAssignments,
            coverage,
            total_days: total
        });

    } catch (error) {
        console.error('Error al obtener cuadrícula:', error);
        res.status(500).json({ error: 'Error al obtener cuadrícula' });
    }
});

// ─── POST /api/schedules ─────────────────────────────────────────────────────
// Crear o actualizar (upsert) cuadrícula
router.post('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'shifts');
        if (!hasAccess) return;

        const { store_name, year, month, min_morning, min_afternoon, assignments, closed_afternoons, published } = req.body;

        if (!store_name || year === undefined || month === undefined) {
            return res.status(400).json({ error: 'Faltan campos requeridos: store_name, year, month' });
        }

        const y = parseInt(year, 10);
        const m = parseInt(month, 10);

        const update = { store_name, year: y, month: m };
        if (min_morning !== undefined) update.min_morning = Number(min_morning);
        if (min_afternoon !== undefined) update.min_afternoon = Number(min_afternoon);
        if (assignments !== undefined) update.assignments = assignments;
        if (closed_afternoons !== undefined) update.closed_afternoons = closed_afternoons;
        if (published !== undefined) update.published = !!published;
        if (req.user && req.user._id) update.created_by = req.user._id;

        const schedule = await MonthlySchedule.findOneAndUpdate(
            { store_name, year: y, month: m },
            { $set: update },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.status(201).json({ id: schedule._id, message: 'Cuadrícula guardada correctamente', schedule });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Ya existe una cuadrícula para esa tienda y mes' });
        }
        console.error('Error al guardar cuadrícula:', error);
        res.status(500).json({ error: 'Error al guardar cuadrícula' });
    }
});

// ─── PUT /api/schedules/:id ──────────────────────────────────────────────────
// Actualizar asignaciones, días cerrados o configuración
router.put('/:id', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'shifts');
        if (!hasAccess) return;

        const existing = await MonthlySchedule.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Cuadrícula no encontrada' });

        const { min_morning, min_afternoon, assignments, closed_afternoons, published } = req.body;

        const update = {};
        if (min_morning !== undefined) update.min_morning = Number(min_morning);
        if (min_afternoon !== undefined) update.min_afternoon = Number(min_afternoon);
        if (assignments !== undefined) update.assignments = assignments;
        if (closed_afternoons !== undefined) update.closed_afternoons = closed_afternoons;
        if (published !== undefined) update.published = !!published;

        const updated = await MonthlySchedule.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
        res.json({ message: 'Cuadrícula actualizada correctamente', schedule: updated });

    } catch (error) {
        console.error('Error al actualizar cuadrícula:', error);
        res.status(500).json({ error: 'Error al actualizar cuadrícula' });
    }
});

// ─── POST /api/schedules/:id/auto-generate ───────────────────────────────────
// Auto-generar asignaciones desde shift_id de empleados
router.post('/:id/auto-generate', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'shifts');
        if (!hasAccess) return;

        const schedule = await MonthlySchedule.findById(req.params.id);
        if (!schedule) return res.status(404).json({ error: 'Cuadrícula no encontrada' });

        const { year, month, store_name } = schedule;

        // Obtener empleados activos de la tienda con shift
        const employees = await Employee.find({ location: store_name, status: 'active' })
            .select('_id full_name shift_id')
            .lean();

        // Obtener todos los shifts de la tienda
        const shiftIds = [...new Set(employees.map(e => e.shift_id).filter(Boolean))];
        const shifts = await Shift.find({ _id: { $in: shiftIds } }).lean();
        const shiftMap = {};
        for (const s of shifts) shiftMap[s._id.toString()] = s;

        const total = daysInMonth(year, month);
        const assignments = [];

        // Identificar qué sábados del mes son el 1º, 2º, 3º, 4º sábado
        const saturdayIndices = {}; // day -> 0-based index (0=primer sábado del mes)
        let satCount = 0;
        for (let d = 1; d <= total; d++) {
            const dow = new Date(Date.UTC(year, month, d)).getUTCDay(); // 0=Dom, 6=Sáb
            if (dow === 6) {
                saturdayIndices[d] = satCount++;
            }
        }

        for (const emp of employees) {
            if (!emp.shift_id) {
                // Sin turno asignado → libre todos los días
                for (let d = 1; d <= total; d++) {
                    assignments.push({ employee_id: emp._id, day: d, slot: 'L' });
                }
                continue;
            }

            const shift = shiftMap[emp.shift_id.toString()];
            if (!shift) continue;

            // Determinar slot base según horario: mañana o tarde según hora de inicio
            const startHour = shift.weekdayStart ? parseInt(shift.weekdayStart.split(':')[0], 10) : 8;
            const baseSlot = startHour < 14 ? 'M' : 'T'; // antes de las 14h = mañana

            const openDays = shift.openDays || [1, 2, 3, 4, 5];
            const openDaySet = new Set(openDays);
            const satWeeksOff = new Set(shift.satWeeksOff || []);

            for (let d = 1; d <= total; d++) {
                const dow = new Date(Date.UTC(year, month, d)).getUTCDay();

                if (dow === 0) {
                    // Domingo → siempre libre
                    assignments.push({ employee_id: emp._id, day: d, slot: 'L' });
                } else if (dow === 6) {
                    // Sábado
                    if (!openDaySet.has(6)) {
                        assignments.push({ employee_id: emp._id, day: d, slot: 'L' });
                    } else {
                        const satIdx = saturdayIndices[d];
                        if (satWeeksOff.has(satIdx)) {
                            assignments.push({ employee_id: emp._id, day: d, slot: 'L' });
                        } else {
                            assignments.push({ employee_id: emp._id, day: d, slot: baseSlot });
                        }
                    }
                } else {
                    // Lunes–Viernes
                    if (openDaySet.has(dow)) {
                        assignments.push({ employee_id: emp._id, day: d, slot: baseSlot });
                    } else {
                        assignments.push({ employee_id: emp._id, day: d, slot: 'L' });
                    }
                }
            }
        }

        // Guardar y devolver
        schedule.assignments = assignments;
        await schedule.save();

        res.json({ message: 'Cuadrícula auto-generada correctamente', assignments });

    } catch (error) {
        console.error('Error al auto-generar cuadrícula:', error);
        res.status(500).json({ error: 'Error al auto-generar cuadrícula' });
    }
});

// ─── DELETE /api/schedules/:id ───────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'shifts');
        if (!hasAccess) return;

        const existing = await MonthlySchedule.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Cuadrícula no encontrada' });

        await MonthlySchedule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Cuadrícula eliminada correctamente' });

    } catch (error) {
        console.error('Error al eliminar cuadrícula:', error);
        res.status(500).json({ error: 'Error al eliminar cuadrícula' });
    }
});

// ─── GET /api/schedules/employee/:employeeId ─────────────────────────────────
// Devuelve los slots del mes actual para un empleado (portal empleado)
router.get('/employee/:employeeId', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'shifts');
        if (!hasAccess) return;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        const { employeeId } = req.params;

        const employee = await Employee.findById(employeeId).select('location').lean();
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const schedule = await MonthlySchedule.findOne({ store_name: employee.location, year, month }).lean();
        if (!schedule) return res.json({ schedule: null, slots: [] });

        const slots = schedule.assignments
            .filter(a => a.employee_id.toString() === employeeId)
            .map(a => ({ day: a.day, slot: a.slot }));

        res.json({ schedule_id: schedule._id, store_name: schedule.store_name, year, month, slots });

    } catch (error) {
        console.error('Error al obtener slots del empleado:', error);
        res.status(500).json({ error: 'Error al obtener horario del empleado' });
    }
});

module.exports = router;
