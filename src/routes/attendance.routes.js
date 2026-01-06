const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, ensureEmployeeInScope, isStoreCoordinator, getStoreLocations, getStoreEmployeeIds } = require('../utils/accessScope');

router.use(authenticateToken);

function isAutocloseEnabled() {
    const v = process.env.ATTENDANCE_AUTOCLOSE_ENABLED;
    if (v === undefined || v === null || v === '') return true;
    return String(v).toLowerCase() === 'true' || String(v) === '1';
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

        // Idempotencia para turnos partidos:
        // Solo evitamos autocerrar si YA existe un OUT DESPUÉS del último fichaje.
        // (En turnos partidos puede haber OUT a mediodía, y luego un IN por la tarde.)
        const existingOutAfterLast = await Attendance.findOne({
            employee_id: employeeId,
            type: 'out',
            timestamp: { $gt: lastRecord.timestamp, $lte: dayEnd }
        }).sort({ timestamp: -1 });

        if (existingOutAfterLast) continue;

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

function normalizeOverridesContainer(overrides) {
    // Acepta Map (mongoose) u objeto plano
    if (!overrides) return null;
    if (overrides instanceof Map) {
        const out = {};
        for (const [k, v] of overrides.entries()) out[String(k)] = v;
        return out;
    }
    if (typeof overrides === 'object' && !Array.isArray(overrides)) return overrides;
    return null;
}

function getScheduleForDay(baseSchedule, dateKey, dow) {
    const base = baseSchedule || {};
    const baseDays = Array.isArray(base.days_of_week) ? base.days_of_week : [1, 2, 3, 4, 5];
    const baseWorking = baseDays.includes(dow);

    const dayOverrides = normalizeOverridesContainer(base.day_overrides);
    const dayOverride = dayOverrides ? dayOverrides[String(dow)] : null;

    const dateOverrides = Array.isArray(base.date_overrides) ? base.date_overrides : [];
    const dateOverride = dateOverrides.find(o => o && o.date === dateKey) || null;

    const chosen = dateOverride || dayOverride || null;

    // enabled puede forzar trabajar/no trabajar ese día
    const enabled = chosen && Object.prototype.hasOwnProperty.call(chosen, 'enabled') ? Boolean(chosen.enabled) : null;
    const workingDay = enabled === null ? baseWorking : enabled;

    const start_time = (chosen && chosen.start_time) ? chosen.start_time : base.start_time;
    const end_time = (chosen && chosen.end_time) ? chosen.end_time : base.end_time;
    const break_start = (chosen && chosen.break_start !== undefined) ? chosen.break_start : base.break_start;
    const break_end = (chosen && chosen.break_end !== undefined) ? chosen.break_end : base.break_end;
    const tolerance = Number.isFinite(Number(base.tolerance_minutes)) ? Number(base.tolerance_minutes) : 10;

    return {
        workingDay,
        start_time,
        end_time,
        break_start,
        break_end,
        tolerance_minutes: tolerance
    };
}

async function buildComplianceForEmployee(employeeId, { startDate, endDate } = {}) {
    const employee = await Employee.findById(employeeId).lean();
    const schedule = employee?.work_schedule || null;

    if (!schedule || !schedule.enabled) {
        return { scheduleEnabled: false, schedule: schedule || null, days: [] };
    }

    // Validación mínima del horario base (los overrides se validan al guardar desde /employees/:id)
    if (!isValidTimeHHmm(schedule.start_time) || !isValidTimeHHmm(schedule.end_time)) {
        return { scheduleEnabled: true, schedule, days: [], warning: 'Horario inválido: start_time/end_time' };
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

        const daySchedule = getScheduleForDay(schedule, dateKey, dow);
        const workingDay = Boolean(daySchedule.workingDay);
        const dayLogs = logsByDay.get(dateKey) || [];

        const startTime = daySchedule.start_time;
        const endTime = daySchedule.end_time;
        const breakStart = daySchedule.break_start;
        const breakEnd = daySchedule.break_end;
        const tolerance = Number.isFinite(Number(daySchedule.tolerance_minutes)) ? Number(daySchedule.tolerance_minutes) : 10;

        if (workingDay && (!isValidTimeHHmm(startTime) || !isValidTimeHHmm(endTime))) {
            days.push({
                date: dateKey,
                workingDay,
                issues: ['invalid_schedule'],
                expected: { in: true, out: true, break_start: false, break_end: false },
                found: { in: null, out: null, break_start: null, break_end: null },
                warning: 'Horario inválido para este día'
            });
            continue;
        }

        const hasBreak = Boolean(breakStart) && Boolean(breakEnd);

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
        // Turno partido: muchas empresas fichan el descanso como salida/entrada (out/in)
        // en vez de break_start/break_end. Si hay horario con descanso, aceptamos ambos.
        const breakStartCandidates = hasBreak ? (
            logsByType.break_start.concat(
                logsByType.out.filter(l => {
                    // La salida de descanso debe ocurrir antes (o cerca) del fin de descanso.
                    // Así evitamos confundir el OUT de fin de jornada con el de descanso.
                    return expectedBreakEnd ? (new Date(l.timestamp) <= expectedBreakEnd) : true;
                })
            )
        ) : [];

        const breakEndCandidates = hasBreak ? (
            logsByType.break_end.concat(
                logsByType.in.filter(l => {
                    // La entrada tras descanso debe ocurrir después (o cerca) del inicio de descanso.
                    // Así evitamos confundir el IN de primera hora con el IN de la tarde.
                    return expectedBreakStart ? (new Date(l.timestamp) >= expectedBreakStart) : true;
                })
            )
        ) : [];

        const chosenBreakStart = hasBreak ? pickClosestLog(breakStartCandidates, expectedBreakStart) : null;
        const chosenBreakEnd = hasBreak ? pickClosestLog(breakEndCandidates, expectedBreakEnd) : null;

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
        // Nota: en entornos serverless (Vercel) puede generar muchas lecturas en picos de login.
        if (isAutocloseEnabled()) {
            await autoCloseForgottenOutsForEmployee(employee_id);
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const lastRecord = await Attendance.findOne({
            employee_id,
            timestamp: { $gte: startOfDay }
        }).sort({ timestamp: -1 });

        const firstInToday = await Attendance.findOne({
            employee_id,
            type: 'in',
            timestamp: { $gte: startOfDay }
        }).sort({ timestamp: 1 });

        res.json({
            todayStatus: lastRecord ? lastRecord.type : 'none',
            lastRecord,
            hasInToday: Boolean(firstInToday)
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
            // Nota: en entornos serverless (Vercel) puede generar muchas lecturas en picos de login.
            if (isAutocloseEnabled()) {
                await autoCloseForgottenOutsForEmployee(req.user.employee_id);
            }

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

// Regularizar fichajes de un empleado en una fecha específica
// Ajusta los timestamps según el horario configurado manteniendo la geolocalización
router.post('/regularize/:employeeId/:date', async (req, res) => {
    try {
        const { employeeId, date } = req.params;
        const { target_hours } = req.body; // Horas personalizadas desde el frontend

        // Verificar acceso
        const hasAccess = await requireFeatureAccess(req, res, 'attendance');
        if (!hasAccess) return;

        const ok = await ensureEmployeeInScope(req, res, employeeId);
        if (!ok) return;

        // Validar formato de fecha YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
        }

        // Obtener empleado y su horario
        const employee = await Employee.findById(employeeId).lean();
        if (!employee) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }

        console.log('Empleado encontrado:', employee.full_name);
        console.log('Horario configurado:', JSON.stringify(employee.work_schedule, null, 2));

        const schedule = employee.work_schedule;
        const targetDate = new Date(date + 'T12:00:00');
        const dow = targetDate.getDay(); // 0=Domingo, 6=Sábado
        
        console.log('Fecha objetivo:', date, 'Día de semana:', dow);
        
        let finalSchedule = {
            start_time: '09:00',
            end_time: '18:00',
            break_start: null,
            break_end: null,
            workingDay: true
        };

        // Si el empleado tiene horario configurado, usarlo como base
        if (schedule && schedule.enabled) {
            if (isValidTimeHHmm(schedule.start_time) && isValidTimeHHmm(schedule.end_time)) {
                console.log('Obteniendo horario del día...');
                const daySchedule = getScheduleForDay(schedule, date, dow);
                console.log('Horario del día obtenido:', JSON.stringify(daySchedule, null, 2));
                finalSchedule = { ...daySchedule };
            } else {
                console.log('Horario base inválido, usando valores por defecto');
            }
        } else {
            console.log('Horario no habilitado o no existe, usando valores por defecto');
        }

        // Si se proporcionaron horas personalizadas, tienen prioridad (funciona con o sin horario configurado)
        if (target_hours) {
            if (target_hours.start_time && isValidTimeHHmm(target_hours.start_time)) {
                finalSchedule.start_time = target_hours.start_time;
                finalSchedule.workingDay = true; // Forzar día laborable si hay horas personalizadas
            }
            if (target_hours.end_time && isValidTimeHHmm(target_hours.end_time)) {
                finalSchedule.end_time = target_hours.end_time;
            }
            if (target_hours.break_start && isValidTimeHHmm(target_hours.break_start)) {
                finalSchedule.break_start = target_hours.break_start;
            }
            if (target_hours.break_end && isValidTimeHHmm(target_hours.break_end)) {
                finalSchedule.break_end = target_hours.break_end;
            }
        } else {
            // Si no hay horas personalizadas Y no hay horario configurado, error
            if (!schedule || !schedule.enabled || !isValidTimeHHmm(schedule.start_time) || !isValidTimeHHmm(schedule.end_time)) {
                return res.status(400).json({ error: 'Debe especificar las horas de ajuste o el empleado debe tener horario configurado' });
            }
            // Verificar si el día es laborable solo cuando NO hay horas personalizadas
            if (!finalSchedule.workingDay) {
                return res.status(400).json({ error: 'Este día no es laborable según el horario configurado. Use horas personalizadas para regularizar de todos modos.' });
            }
        }

        // Obtener fichajes existentes de ese día
        const dayStart = startOfDayLocal(targetDate);
        const dayEnd = endOfDayLocal(targetDate);

        const logs = await Attendance.find({
            employee_id: employeeId,
            timestamp: { $gte: dayStart, $lte: dayEnd }
        }).sort({ timestamp: 1 }).lean();

        if (logs.length === 0) {
            return res.status(400).json({ error: 'No hay fichajes para este día' });
        }

        // Separar por tipo
        const inLogs = logs.filter(l => l.type === 'in');
        const outLogs = logs.filter(l => l.type === 'out');
        const breakStartLogs = logs.filter(l => l.type === 'break_start');
        const breakEndLogs = logs.filter(l => l.type === 'break_end');

        // Función auxiliar para añadir variación aleatoria de minutos (±7-8 minutos)
        function addRandomVariation(date) {
            const variation = Math.floor(Math.random() * 16) - 8; // -8 a +7 minutos
            const newDate = new Date(date);
            newDate.setMinutes(newDate.getMinutes() + variation);
            return newDate;
        }

        // Construir timestamps objetivo según el horario
        const targetTimestamps = {};
        
        // Entrada: usar start_time del horario final con variación
        if (inLogs.length > 0) {
            const [hours, minutes] = finalSchedule.start_time.split(':').map(Number);
            const targetIn = new Date(targetDate);
            targetIn.setHours(hours, minutes, 0, 0);
            targetTimestamps.in = addRandomVariation(targetIn);
        }

        // Salida: usar end_time del horario final con variación
        if (outLogs.length > 0) {
            const [hours, minutes] = finalSchedule.end_time.split(':').map(Number);
            const targetOut = new Date(targetDate);
            targetOut.setHours(hours, minutes, 0, 0);
            targetTimestamps.out = addRandomVariation(targetOut);
        }

        // Descansos: usar break_start y break_end si están configurados con variación
        if (finalSchedule.break_start && isValidTimeHHmm(finalSchedule.break_start) && breakStartLogs.length > 0) {
            const [hours, minutes] = finalSchedule.break_start.split(':').map(Number);
            const targetBreakStart = new Date(targetDate);
            targetBreakStart.setHours(hours, minutes, 0, 0);
            targetTimestamps.break_start = addRandomVariation(targetBreakStart);
        }

        if (finalSchedule.break_end && isValidTimeHHmm(finalSchedule.break_end) && breakEndLogs.length > 0) {
            const [hours, minutes] = finalSchedule.break_end.split(':').map(Number);
            const targetBreakEnd = new Date(targetDate);
            targetBreakEnd.setHours(hours, minutes, 0, 0);
            targetTimestamps.break_end = addRandomVariation(targetBreakEnd);
        }

        // Actualizar los fichajes manteniendo geolocalización y otros datos
        const updates = [];
        const auditBefore = [];
        const auditAfter = [];

        // Actualizar entrada (primer registro de 'in')
        if (targetTimestamps.in && inLogs.length > 0) {
            const log = inLogs[0];
            auditBefore.push({ type: 'in', timestamp: log.timestamp, _id: log._id });
            await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.in });
            auditAfter.push({ type: 'in', timestamp: targetTimestamps.in, _id: log._id });
            updates.push({ type: 'in', from: log.timestamp, to: targetTimestamps.in });
        }

        // Actualizar salida (último registro de 'out')
        if (targetTimestamps.out && outLogs.length > 0) {
            const log = outLogs[outLogs.length - 1];
            auditBefore.push({ type: 'out', timestamp: log.timestamp, _id: log._id });
            await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.out });
            auditAfter.push({ type: 'out', timestamp: targetTimestamps.out, _id: log._id });
            updates.push({ type: 'out', from: log.timestamp, to: targetTimestamps.out });
        }

        // Actualizar inicio descanso (primer registro de 'break_start')
        if (targetTimestamps.break_start && breakStartLogs.length > 0) {
            const log = breakStartLogs[0];
            auditBefore.push({ type: 'break_start', timestamp: log.timestamp, _id: log._id });
            await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.break_start });
            auditAfter.push({ type: 'break_start', timestamp: targetTimestamps.break_start, _id: log._id });
            updates.push({ type: 'break_start', from: log.timestamp, to: targetTimestamps.break_start });
        }

        // Actualizar fin descanso (primer registro de 'break_end')
        if (targetTimestamps.break_end && breakEndLogs.length > 0) {
            const log = breakEndLogs[0];
            auditBefore.push({ type: 'break_end', timestamp: log.timestamp, _id: log._id });
            await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.break_end });
            auditAfter.push({ type: 'break_end', timestamp: targetTimestamps.break_end, _id: log._id });
            updates.push({ type: 'break_end', from: log.timestamp, to: targetTimestamps.break_end });
        }

        // Registrar en audit log
        const AuditLog = require('../models/AuditLog');
        await AuditLog.create({
            actor: {
                user_id: req.user._id,
                username: req.user.username,
                role: req.user.role || 'admin'
            },
            action: 'attendance.regularize',
            entity: {
                type: 'Attendance',
                id: String(employeeId)
            },
            employee: {
                id: String(employeeId),
                location: employee.location || ''
            },
            before: auditBefore,
            after: auditAfter,
            meta: {
                date,
                updatesCount: updates.length,
                schedule: {
                    start_time: finalSchedule.start_time,
                    end_time: finalSchedule.end_time,
                    break_start: finalSchedule.break_start || null,
                    break_end: finalSchedule.break_end || null
                },
                customHours: target_hours ? true : false
            }
        });

        res.json({
            message: 'Fichajes regularizados correctamente',
            updates,
            date,
            employee: employee.full_name
        });

    } catch (error) {
        console.error('Error al regularizar fichajes:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error al regularizar fichajes',
            details: error.message 
        });
    }
});

// Ruta para regularización masiva de múltiples días
router.post('/regularize-bulk', async (req, res) => {
    try {
        const { employeeId, dates, target_hours } = req.body;

        // Verificar acceso
        const hasAccess = await requireFeatureAccess(req, res, 'attendance');
        if (!hasAccess) return;

        const ok = await ensureEmployeeInScope(req, res, employeeId);
        if (!ok) return;

        if (!employeeId || !dates || !Array.isArray(dates) || dates.length === 0) {
            return res.status(400).json({ error: 'Debe proporcionar employeeId y un array de fechas' });
        }

        if (!target_hours || !target_hours.start_time || !target_hours.end_time) {
            return res.status(400).json({ error: 'Debe especificar start_time y end_time en target_hours' });
        }

        // Obtener empleado
        const employee = await Employee.findById(employeeId).lean();
        if (!employee) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }

        const results = {
            success: [],
            failed: [],
            totalDays: dates.length
        };

        // Procesar cada fecha
        for (const date of dates) {
            try {
                // Validar formato de fecha
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    results.failed.push({ date, error: 'Formato de fecha inválido' });
                    continue;
                }

                const targetDate = new Date(date + 'T12:00:00');
                
                // Preparar horario final con variación
                const finalSchedule = {
                    start_time: target_hours.start_time,
                    end_time: target_hours.end_time,
                    break_start: target_hours.break_start || null,
                    break_end: target_hours.break_end || null,
                    workingDay: true
                };

                // Obtener fichajes del día
                const dayStart = startOfDayLocal(targetDate);
                const dayEnd = endOfDayLocal(targetDate);

                const logs = await Attendance.find({
                    employee_id: employeeId,
                    timestamp: { $gte: dayStart, $lte: dayEnd }
                }).sort({ timestamp: 1 }).lean();

                if (logs.length === 0) {
                    results.failed.push({ date, error: 'No hay fichajes' });
                    continue;
                }

                // Separar por tipo
                const inLogs = logs.filter(l => l.type === 'in');
                const outLogs = logs.filter(l => l.type === 'out');
                const breakStartLogs = logs.filter(l => l.type === 'break_start');
                const breakEndLogs = logs.filter(l => l.type === 'break_end');

                // Función para añadir variación aleatoria
                function addRandomVariation(date) {
                    const variation = Math.floor(Math.random() * 16) - 8; // -8 a +7 minutos
                    const newDate = new Date(date);
                    newDate.setMinutes(newDate.getMinutes() + variation);
                    return newDate;
                }

                const targetTimestamps = {};
                const updates = [];

                // Entrada
                if (inLogs.length > 0) {
                    const [hours, minutes] = finalSchedule.start_time.split(':').map(Number);
                    const targetIn = new Date(targetDate);
                    targetIn.setHours(hours, minutes, 0, 0);
                    targetTimestamps.in = addRandomVariation(targetIn);
                    
                    const log = inLogs[0];
                    await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.in });
                    updates.push({ type: 'in', from: log.timestamp, to: targetTimestamps.in });
                }

                // Salida
                if (outLogs.length > 0) {
                    const [hours, minutes] = finalSchedule.end_time.split(':').map(Number);
                    const targetOut = new Date(targetDate);
                    targetOut.setHours(hours, minutes, 0, 0);
                    targetTimestamps.out = addRandomVariation(targetOut);
                    
                    const log = outLogs[outLogs.length - 1];
                    await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.out });
                    updates.push({ type: 'out', from: log.timestamp, to: targetTimestamps.out });
                }

                // Descanso inicio
                if (finalSchedule.break_start && isValidTimeHHmm(finalSchedule.break_start) && breakStartLogs.length > 0) {
                    const [hours, minutes] = finalSchedule.break_start.split(':').map(Number);
                    const targetBreakStart = new Date(targetDate);
                    targetBreakStart.setHours(hours, minutes, 0, 0);
                    targetTimestamps.break_start = addRandomVariation(targetBreakStart);
                    
                    const log = breakStartLogs[0];
                    await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.break_start });
                    updates.push({ type: 'break_start', from: log.timestamp, to: targetTimestamps.break_start });
                }

                // Descanso fin
                if (finalSchedule.break_end && isValidTimeHHmm(finalSchedule.break_end) && breakEndLogs.length > 0) {
                    const [hours, minutes] = finalSchedule.break_end.split(':').map(Number);
                    const targetBreakEnd = new Date(targetDate);
                    targetBreakEnd.setHours(hours, minutes, 0, 0);
                    targetTimestamps.break_end = addRandomVariation(targetBreakEnd);
                    
                    const log = breakEndLogs[0];
                    await Attendance.findByIdAndUpdate(log._id, { timestamp: targetTimestamps.break_end });
                    updates.push({ type: 'break_end', from: log.timestamp, to: targetTimestamps.break_end });
                }

                // Registrar en audit log
                const AuditLog = require('../models/AuditLog');
                await AuditLog.create({
                    user_id: req.user._id,
                    username: req.user.username,
                    action: 'attendance.regularize.bulk',
                    entityType: 'Attendance',
                    entityId: String(employeeId),
                    employeeId: String(employeeId),
                    employeeLocation: employee.location || '',
                    meta: {
                        date,
                        updatesCount: updates.length,
                        schedule: finalSchedule,
                        bulkOperation: true
                    }
                });

                results.success.push({ date, updates: updates.length });

            } catch (error) {
                console.error(`Error al regularizar fecha ${date}:`, error);
                results.failed.push({ date, error: error.message });
            }
        }

        res.json({
            message: `Regularización masiva completada: ${results.success.length} días procesados correctamente, ${results.failed.length} fallidos`,
            results
        });

    } catch (error) {
        console.error('Error en regularización masiva:', error);
        res.status(500).json({ error: 'Error en regularización masiva' });
    }
});

module.exports = router;
