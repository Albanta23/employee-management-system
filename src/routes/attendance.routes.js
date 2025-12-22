const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, ensureEmployeeInScope, isStoreCoordinator, getStoreLocations, getStoreEmployeeIds } = require('../utils/accessScope');

router.use(authenticateToken);

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

async function autoCloseForgottenOutsForEmployee(employeeId, { lookbackDays = 7 } = {}) {
    // Solo autocerramos días PASADOS para evitar cerrar jornadas en curso.
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

        // Idempotencia: si ya existe un OUT ese día, no creamos otro.
        const existingOut = await Attendance.findOne({
            employee_id: employeeId,
            type: 'out',
            timestamp: { $gte: dayStart, $lte: dayEnd }
        }).sort({ timestamp: -1 });

        if (existingOut) continue;

        // Crear el OUT al final del día (o al menos después del último fichaje del día)
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

function isValidTimeHHmm(value) {
    if (typeof value !== 'string') return false;
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function parseHHmmToDate(dayStart, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(dayStart);
    d.setHours(h, m, 0, 0);
    return d;
}

function localDateKey(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function minutesDiff(a, b) {
    return Math.round(Math.abs(a.getTime() - b.getTime()) / 60000);
}

function pickClosestLog(logs, targetTime) {
    if (!logs || logs.length === 0) return null;
    let best = logs[0];
    let bestDiff = Math.abs(new Date(best.timestamp).getTime() - targetTime.getTime());
    for (let i = 1; i < logs.length; i++) {
        const diff = Math.abs(new Date(logs[i].timestamp).getTime() - targetTime.getTime());
        if (diff < bestDiff) {
            best = logs[i];
            bestDiff = diff;
        }
    }
    return best;
}

async function buildComplianceForEmployee(employeeId, { startDate, endDate } = {}) {
    const employee = await Employee.findById(employeeId).lean();
    const schedule = employee?.work_schedule || null;

    if (!schedule || !schedule.enabled) {
        return { scheduleEnabled: false, schedule: schedule || null, days: [] };
    }

    const daysOfWeek = Array.isArray(schedule.days_of_week) ? schedule.days_of_week : [1, 2, 3, 4, 5];
    const startTime = schedule.start_time;
    const endTime = schedule.end_time;
    const breakStart = schedule.break_start;
    const breakEnd = schedule.break_end;
    const tolerance = Number.isFinite(Number(schedule.tolerance_minutes)) ? Number(schedule.tolerance_minutes) : 10;

    if (!isValidTimeHHmm(startTime) || !isValidTimeHHmm(endTime)) {
        return { scheduleEnabled: true, schedule, days: [], warning: 'Horario inválido: start_time/end_time' };
    }
    const hasBreak = Boolean(breakStart) && Boolean(breakEnd);
    if ((Boolean(breakStart) || Boolean(breakEnd)) && !(Boolean(breakStart) && Boolean(breakEnd))) {
        return { scheduleEnabled: true, schedule, days: [], warning: 'Horario inválido: descanso incompleto' };
    }
    if (hasBreak && (!isValidTimeHHmm(breakStart) || !isValidTimeHHmm(breakEnd))) {
        return { scheduleEnabled: true, schedule, days: [], warning: 'Horario inválido: descanso' };
    }

    const rangeStart = startDate ? startOfDayLocal(new Date(startDate)) : (() => {
        const d = startOfDayLocal(new Date());
        d.setDate(d.getDate() - 7);
        return d;
    })();

    const rangeEnd = endDate ? endOfDayLocal(new Date(endDate)) : endOfDayLocal(new Date());

    const logs = await Attendance.find({
        employee_id: employeeId,
        timestamp: { $gte: rangeStart, $lte: rangeEnd }
    }).sort({ timestamp: 1 }).lean();

    const logsByDay = new Map();
    for (const log of logs) {
        const key = localDateKey(log.timestamp);
        if (!logsByDay.has(key)) logsByDay.set(key, []);
        logsByDay.get(key).push(log);
    }

    const days = [];
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const dayStart = startOfDayLocal(d);
        const dayEnd = endOfDayLocal(d);
        const dateKey = localDateKey(d);
        const dow = dayStart.getDay();

        const workingDay = daysOfWeek.includes(dow);
        const dayLogs = logsByDay.get(dateKey) || [];

        const result = {
            date: dateKey,
            workingDay,
            issues: [],
            expected: { in: true, out: true, break_start: hasBreak, break_end: hasBreak },
            found: { in: null, out: null, break_start: null, break_end: null }
        };

        if (!workingDay) {
            days.push(result);
            continue;
        }

        const expectedIn = parseHHmmToDate(dayStart, startTime);
        const expectedOut = parseHHmmToDate(dayStart, endTime);
        const expectedBreakStart = hasBreak ? parseHHmmToDate(dayStart, breakStart) : null;
        const expectedBreakEnd = hasBreak ? parseHHmmToDate(dayStart, breakEnd) : null;

        const logsByType = {
            in: dayLogs.filter(l => l.type === 'in'),
            out: dayLogs.filter(l => l.type === 'out'),
            break_start: dayLogs.filter(l => l.type === 'break_start'),
            break_end: dayLogs.filter(l => l.type === 'break_end')
        };

        const chosenIn = pickClosestLog(logsByType.in, expectedIn);
        const chosenOut = pickClosestLog(logsByType.out, expectedOut);
        const chosenBreakStart = hasBreak ? pickClosestLog(logsByType.break_start, expectedBreakStart) : null;
        const chosenBreakEnd = hasBreak ? pickClosestLog(logsByType.break_end, expectedBreakEnd) : null;

        result.found.in = chosenIn;
        result.found.out = chosenOut;
        result.found.break_start = chosenBreakStart;
        result.found.break_end = chosenBreakEnd;

        if (!chosenIn) result.issues.push('missing_in');
        if (!chosenOut) result.issues.push('missing_out');
        if (hasBreak && !chosenBreakStart) result.issues.push('missing_break_start');
        if (hasBreak && !chosenBreakEnd) result.issues.push('missing_break_end');

        if (chosenIn) {
            const diff = minutesDiff(new Date(chosenIn.timestamp), expectedIn);
            if (diff > tolerance) result.issues.push('out_of_window_in');
        }
        if (chosenOut) {
            const diff = minutesDiff(new Date(chosenOut.timestamp), expectedOut);
            if (diff > tolerance) result.issues.push('out_of_window_out');
        }
        if (hasBreak && chosenBreakStart) {
            const diff = minutesDiff(new Date(chosenBreakStart.timestamp), expectedBreakStart);
            if (diff > tolerance) result.issues.push('out_of_window_break_start');
        }
        if (hasBreak && chosenBreakEnd) {
            const diff = minutesDiff(new Date(chosenBreakEnd.timestamp), expectedBreakEnd);
            if (diff > tolerance) result.issues.push('out_of_window_break_end');
        }

        // Orden mínimo
        const tIn = chosenIn ? new Date(chosenIn.timestamp).getTime() : null;
        const tOut = chosenOut ? new Date(chosenOut.timestamp).getTime() : null;
        const tBs = chosenBreakStart ? new Date(chosenBreakStart.timestamp).getTime() : null;
        const tBe = chosenBreakEnd ? new Date(chosenBreakEnd.timestamp).getTime() : null;

        if (tIn !== null && tOut !== null && tIn > tOut) result.issues.push('order_in_after_out');
        if (hasBreak && tIn !== null && tBs !== null && tBs < tIn) result.issues.push('order_break_start_before_in');
        if (hasBreak && tBs !== null && tBe !== null && tBs > tBe) result.issues.push('order_break_start_after_break_end');
        if (hasBreak && tOut !== null && tBe !== null && tBe > tOut) result.issues.push('order_break_end_after_out');

        // Limpiar duplicados de issues
        result.issues = Array.from(new Set(result.issues));

        days.push(result);
    }

    return { scheduleEnabled: true, schedule, days };
}

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

        // Autocierre de salidas olvidadas en días pasados (sin cron)
        await autoCloseForgottenOutsForEmployee(employee_id);

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
        const { start_date, end_date, employee_id } = req.query;
        const query = {};

        console.log('📊 /report - Usuario:', req.user.username, 'Rol:', req.user.role, 'Employee_id:', req.user.employee_id);

        // Si es empleado normal (role=employee), solo puede ver su propio historial
        // Usuarios sin rol específico o con rol 'admin' pueden ser manejados diferente
        if (req.user.role === 'employee' || (!req.user.role && req.user.employee_id)) {
            if (!req.user.employee_id) {
                return res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
            }

            // Autocierre de salidas olvidadas en días pasados (sin cron)
            await autoCloseForgottenOutsForEmployee(req.user.employee_id);

            query.employee_id = req.user.employee_id;
        } else if (req.user.role === 'admin') {
            // Admin puede ver todo, opcionalmente filtrar por employee_id
            if (employee_id) {
                query.employee_id = employee_id;
            }
        } else {
            // store_coordinator u otros roles necesitan pasar el check de acceso
            const hasAccess = await requireFeatureAccess(req, res, 'attendance');
            if (!hasAccess) return;

            if (employee_id) {
                const ok = await ensureEmployeeInScope(req, res, employee_id);
                if (!ok) return;
                query.employee_id = employee_id;
            }

            if (isStoreCoordinator(req.user) && !employee_id) {
                const ids = await getStoreEmployeeIds();
                query.employee_id = { $in: ids };
            }
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

// Cumplimiento del horario (portal empleado)
router.get('/compliance', async (req, res) => {
    try {
        const { start_date, end_date, employee_id } = req.query;

        // Empleado: solo su propio cumplimiento
        if (req.user.role === 'employee' || (!req.user.role && req.user.employee_id)) {
            if (!req.user.employee_id) {
                return res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
            }
            const result = await buildComplianceForEmployee(req.user.employee_id, {
                startDate: start_date,
                endDate: end_date
            });
            return res.json(result);
        }

        // Admin o roles con acceso (opcional) pueden pedir por employee_id
        if (req.user.role === 'admin') {
            if (!employee_id) return res.status(400).json({ error: 'employee_id es requerido' });
            const result = await buildComplianceForEmployee(employee_id, {
                startDate: start_date,
                endDate: end_date
            });
            return res.json(result);
        }

        const hasAccess = await requireFeatureAccess(req, res, 'attendance');
        if (!hasAccess) return;
        if (!employee_id) return res.status(400).json({ error: 'employee_id es requerido' });

        const ok = await ensureEmployeeInScope(req, res, employee_id);
        if (!ok) return;

        const result = await buildComplianceForEmployee(employee_id, {
            startDate: start_date,
            endDate: end_date
        });
        return res.json(result);
    } catch (error) {
        console.error('Error al obtener compliance:', error);
        res.status(500).json({ error: 'Error al obtener compliance' });
    }
});

module.exports = router;
