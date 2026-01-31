const express = require('express');
const router = express.Router();
const Vacation = require('../models/Vacation');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, ensureEmployeeInScope, isStoreCoordinator, getStoreLocations, getStoreEmployeeIds, getSettingsForAccess } = require('../utils/accessScope');
const { logAudit, pick, shallowDiff } = require('../utils/audit');

router.use(authenticateToken);

function isEmployeeUser(user) {
    return !!user && (user.role === 'employee' || (!!user.employee_id && !user.role));
}

function ensureEmployeeLinked(req, res) {
    if (!req.user || !req.user.employee_id) {
        res.status(403).json({ error: 'Usuario no vinculado a un empleado' });
        return false;
    }
    return true;
}

function ensureSelfEmployee(req, res, employeeId) {
    if (!ensureEmployeeLinked(req, res)) return false;
    if (String(employeeId) !== String(req.user.employee_id)) {
        res.status(403).json({ error: 'Acceso denegado' });
        return false;
    }
    return true;
}

function getFeatureKeyForType(type) {
    return String(type || '').toLowerCase() === 'vacation' ? 'vacations' : 'permissions';
}

function parseYear(value) {
    const year = Number.parseInt(String(value || ''), 10);
    const nowYear = new Date().getFullYear();
    if (!Number.isFinite(year)) return nowYear;
    if (year < 1970 || year > 3000) return nowYear;
    return year;
}

function parseYearFromReason(reason) {
    const text = String(reason || '');
    const match = text.match(/\b(19\d{2}|20\d{2})\b/);
    if (!match) return null;
    const y = Number.parseInt(match[1], 10);
    if (!Number.isFinite(y) || y < 1970 || y > 3000) return null;
    return y;
}

function deriveVacationYear({ explicitYear, startDate, reason }) {
    const fromExplicit = Number.parseInt(String(explicitYear ?? ''), 10);
    if (Number.isFinite(fromExplicit) && fromExplicit >= 1970 && fromExplicit <= 3000) return fromExplicit;

    const fromReason = parseYearFromReason(reason);
    if (fromReason) return fromReason;

    const d = startDate instanceof Date ? startDate : new Date(startDate);
    if (!Number.isNaN(d.getTime())) return d.getUTCFullYear();

    return new Date().getUTCFullYear();
}

function sumDaysByStatus(items, status, getDays = (v) => (Number(v && v.days) || 0)) {
    return items
        .filter(v => (v.status || 'pending') === status)
        .reduce((acc, v) => acc + (Number(getDays(v)) || 0), 0);
}

async function reserveEmployeeCarryoverDays(employeeId, daysToReserve) {
    const n = Number(daysToReserve) || 0;
    if (n <= 0) return { ok: true };
    const updated = await Employee.findOneAndUpdate(
        { _id: employeeId, vacation_carryover_days: { $gte: n } },
        { $inc: { vacation_carryover_days: -n } },
        { new: true }
    ).lean();
    if (!updated) return { ok: false, error: 'No hay suficientes días pendientes de otros años para reservar' };
    return { ok: true };
}

async function releaseEmployeeCarryoverDays(employeeId, daysToRelease) {
    const n = Number(daysToRelease) || 0;
    if (n <= 0) return { ok: true };
    await Employee.findByIdAndUpdate(employeeId, { $inc: { vacation_carryover_days: n } }, { new: false }).lean();
    return { ok: true };
}

function parseIsoDateOrNull(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function toUtcDateOnly(d) {
    const date = new Date(d);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function calendarDaysInclusive(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const startUtc = toUtcDateOnly(startDate);
    const endUtc = toUtcDateOnly(endDate);
    if (endUtc < startUtc) return 0;
    const diffDays = Math.floor((endUtc - startUtc) / (1000 * 60 * 60 * 24));
    return diffDays + 1;
}

function toDateOnlyString(d) {
    const date = new Date(d);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function normalizeVacationPolicy(input) {
    const out = {
        proration_enabled: false,
        proration_rounding_increment: 0.5,
        carryover_enabled: false,
        carryover_max_days: 0,
        carryover_expiry_month_day: '03-31'
    };

    if (!input || typeof input !== 'object') return out;

    if (Object.prototype.hasOwnProperty.call(input, 'proration_enabled')) {
        out.proration_enabled = !!input.proration_enabled;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'proration_rounding_increment')) {
        const inc = Number(input.proration_rounding_increment);
        out.proration_rounding_increment = (Number.isFinite(inc) && inc > 0) ? inc : out.proration_rounding_increment;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'carryover_enabled')) {
        out.carryover_enabled = !!input.carryover_enabled;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'carryover_max_days')) {
        const max = Number(input.carryover_max_days);
        out.carryover_max_days = (Number.isFinite(max) && max >= 0) ? max : out.carryover_max_days;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'carryover_expiry_month_day')) {
        const md = String(input.carryover_expiry_month_day || '').trim();
        // Validación simple: MM-DD
        if (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(md)) {
            out.carryover_expiry_month_day = md;
        }
    }

    return out;
}

function utcMidnight(value) {
    const d = new Date(value);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function clampDateToRange(date, minDate, maxDate) {
    const t = date.getTime();
    if (t < minDate.getTime()) return new Date(minDate);
    if (t > maxDate.getTime()) return new Date(maxDate);
    return new Date(date);
}

function diffDaysInclusiveUtc(startUtcMidnight, endUtcMidnight) {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const start = utcMidnight(startUtcMidnight);
    const end = utcMidnight(endUtcMidnight);
    const diff = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
    return diff >= 0 ? (diff + 1) : 0;
}

function roundToIncrement(value, increment) {
    const inc = Number(increment);
    const v = Number(value);
    if (!Number.isFinite(v)) return 0;
    if (!Number.isFinite(inc) || inc <= 0) return v;
    return Math.round(v / inc) * inc;
}

function computeProratedAnnualAllowanceDays(employee, year, policy) {
    const annual = Number(employee && employee.annual_vacation_days);
    const annualDays = Number.isFinite(annual) ? annual : 30;

    if (!policy || !policy.proration_enabled) return annualDays;

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));

    const hireDate = employee && employee.hire_date ? utcMidnight(employee.hire_date) : null;
    const terminationDate = employee && employee.termination_date ? utcMidnight(employee.termination_date) : null;

    let employedStart = yearStart;
    let employedEnd = yearEnd;

    if (hireDate) {
        employedStart = clampDateToRange(hireDate, yearStart, yearEnd);
    }
    if (terminationDate) {
        employedEnd = clampDateToRange(terminationDate, yearStart, yearEnd);
    }

    const totalDaysInYear = diffDaysInclusiveUtc(yearStart, yearEnd);
    const employedDays = diffDaysInclusiveUtc(employedStart, employedEnd);
    if (totalDaysInYear <= 0 || employedDays <= 0) return 0;

    const raw = annualDays * (employedDays / totalDaysInYear);
    const rounded = roundToIncrement(raw, policy.proration_rounding_increment);
    return Math.max(0, Math.min(annualDays, rounded));
}

async function findOverlapsForEmployee({ employeeId, employeeLocation, startDate, endDate, requestType, excludeVacationId = null }) {
    // Solo bloqueamos por solicitudes activas (pendiente/aprobada)
    const activeStatuses = ['pending', 'approved'];

    const settings = await getSettingsForAccess();

    const locationKey = String(employeeLocation || '').trim();
    const locationOverride = (settings && settings.overlap_rules_by_location && locationKey)
        ? (settings.overlap_rules_by_location instanceof Map
            ? settings.overlap_rules_by_location.get(locationKey)
            : settings.overlap_rules_by_location[locationKey])
        : null;

    const overlapRules = locationOverride || (settings && settings.overlap_rules ? settings.overlap_rules : null);

    const categoryFromType = (t) => {
        const normalized = String(t || '').toLowerCase();
        if (!normalized || normalized === 'vacation') return 'vacation';
        return 'permission';
    };
    const newCategory = categoryFromType(requestType);

    const rule = (from, to) => {
        const fallback = true;
        if (!overlapRules || typeof overlapRules !== 'object') return fallback;
        if (!overlapRules[from] || typeof overlapRules[from] !== 'object') return fallback;
        if (!Object.prototype.hasOwnProperty.call(overlapRules[from], to)) return fallback;
        return overlapRules[from][to] !== false;
    };

    const blockWithVacation = rule(newCategory, 'vacation');
    const blockWithPermission = rule(newCategory, 'permission');
    const blockWithAbsence = rule(newCategory, 'absence');

    // Construir consulta para Vacation según los tipos a bloquear.
    const typeOr = [];
    if (blockWithVacation) {
        typeOr.push({ type: 'vacation' }, { type: { $exists: false } }, { type: null });
    }
    if (blockWithPermission) {
        typeOr.push({ type: { $exists: true, $ne: 'vacation' } });
    }

    const vacationPromise = (typeOr.length === 0)
        ? Promise.resolve(null)
        : (async () => {
            const vacationQuery = {
                employee_id: employeeId,
                status: { $in: activeStatuses },
                start_date: { $lte: endDate },
                end_date: { $gte: startDate },
                $or: typeOr
            };

            if (excludeVacationId) {
                vacationQuery._id = { $ne: excludeVacationId };
            }

            return Vacation.findOne(vacationQuery).select('_id type status start_date end_date').lean();
        })();

    const absencePromise = !blockWithAbsence
        ? Promise.resolve(null)
        : Absence.findOne({
            employee_id: employeeId,
            start_date: { $lte: endDate },
            $or: [
                { end_date: { $gte: startDate } },
                { end_date: null },
                { end_date: { $exists: false } }
            ]
        }).select('_id type status start_date end_date').lean();

    const [vacationOverlap, absenceOverlap] = await Promise.all([vacationPromise, absencePromise]);

    return { vacationOverlap, absenceOverlap, newCategory, blockWithVacation, blockWithPermission, blockWithAbsence };
}

function canTransitionStatus(fromStatus, toStatus) {
    const from = fromStatus || 'pending';
    const to = toStatus || 'pending';

    if (from === to) return true;

    const allowed = {
        pending: new Set(['approved', 'rejected', 'cancelled']),
        approved: new Set(['revoked']),
        rejected: new Set([]),
        cancelled: new Set([]),
        revoked: new Set([])
    };

    return !!allowed[from] && allowed[from].has(to);
}

async function getEmployeeInScope(req, res, employeeId) {
    const ok = await ensureEmployeeInScope(req, res, employeeId);
    if (!ok) return null;
    const employee = await Employee.findById(employeeId).lean();
    if (!employee) {
        res.status(404).json({ error: 'Empleado no encontrado' });
        return null;
    }
    return employee;
}

async function buildTimeOffBalanceForEmployee(employeeId, year, options = {}) {
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);

    const includePreviousYearForCarryover = !!options.includePreviousYearForCarryover;
    const prevYear = year - 1;
    const prevStart = new Date(`${prevYear}-01-01T00:00:00.000Z`);
    const queryStart = includePreviousYearForCarryover ? prevStart : start;

    const yearSet = includePreviousYearForCarryover ? [year, prevYear] : [year];

    const [items, deductibleAbsences] = await Promise.all([
        Vacation.find({
            employee_id: employeeId,
            $or: [
                // Preferencia: imputación por año contable (si existe)
                { vacation_year: { $in: yearSet } },
                // Compatibilidad: registros antiguos sin vacation_year (por solape de fechas)
                { start_date: { $lte: end }, end_date: { $gte: queryStart } }
            ]
        }).lean(),
        Absence.find({
            employee_id: employeeId,
            deduct_from_vacation: true,
            start_date: { $lte: end },
            $or: [
                { end_date: { $gte: queryStart } },
                { end_date: null },
                { end_date: { $exists: false } }
            ]
        }).select('start_date end_date type status deduct_vacation_days').lean()
    ]);

    const getYearTag = (v) => {
        const vy = Number(v && v.vacation_year);
        if (Number.isFinite(vy) && vy >= 1970 && vy <= 3000) return vy;
        // Fallback para datos antiguos: imputar al año de inicio (UTC)
        const s = v && v.start_date ? new Date(v.start_date) : null;
        if (s && !Number.isNaN(s.getTime())) return s.getUTCFullYear();
        return null;
    };

    const itemsCurrentYear = items.filter(v => {
        const tag = getYearTag(v);
        return tag === year;
    });

    const itemsPrevYear = includePreviousYearForCarryover
        ? items.filter(v => {
            const tag = getYearTag(v);
            return tag === prevYear;
        })
        : [];

    const vacations = itemsCurrentYear.filter(v => (v.type || 'vacation') === 'vacation');
    const permissions = itemsCurrentYear.filter(v => (v.type || 'vacation') !== 'vacation');

    // Para balance anual (año vigente), recalculamos FIFO dinámicamente.
    // Esto asegura que siempre se muestre el desglose correcto aunque haya cambios en carryover.
    const getCurrentYearConsumedDays = (v) => {
        const a = v && v.allocation ? v.allocation : null;
        const current = a && Number.isFinite(Number(a.current_year_days)) ? Number(a.current_year_days) : null;
        if (current !== null) return Math.max(0, current);
        return Number(v && v.days) || 0;
    };

    // NUEVO: Recalcular FIFO dinámicamente para solicitudes pendientes
    // Esto asegura que si cambió el carryover disponible, el balance refleje FIFO correctamente
    const recalculateFIFODynamic = (vacationsList, carryoverAvailableAtTime, yearAllowance) => {
        let carryoverUsed = 0;
        let currentYearUsed = 0;
        let tempCarryoverRemaining = carryoverAvailableAtTime;

        for (const v of vacationsList) {
            if (v.status !== 'pending') continue; // Solo pendientes recalculamos
            
            const totalDays = Number(v.days) || 0;
            if (totalDays === 0) continue;

            const carroverForThis = Math.min(tempCarryoverRemaining, totalDays);
            const currentYearForThis = totalDays - carroverForThis;

            carryoverUsed += carroverForThis;
            currentYearUsed += currentYearForThis;
            tempCarryoverRemaining -= carroverForThis;
        }

        return { carryoverUsed, currentYearUsed };
    };

    const vacationApproved = sumDaysByStatus(vacations, 'approved', getCurrentYearConsumedDays);
    const vacationPending = sumDaysByStatus(vacations, 'pending', getCurrentYearConsumedDays);
    const vacationRejected = sumDaysByStatus(vacations, 'rejected', getCurrentYearConsumedDays);

    const permApproved = sumDaysByStatus(permissions, 'approved', getCurrentYearConsumedDays);
    const permPending = sumDaysByStatus(permissions, 'pending', getCurrentYearConsumedDays);
    const permRejected = sumDaysByStatus(permissions, 'rejected', getCurrentYearConsumedDays);

    const prevVacations = itemsPrevYear.filter(v => (v.type || 'vacation') === 'vacation');
    const prevPermissions = itemsPrevYear.filter(v => (v.type || 'vacation') !== 'vacation');
    const prevVacationApproved = includePreviousYearForCarryover ? sumDaysByStatus(prevVacations, 'approved') : 0;
    const prevVacationPending = includePreviousYearForCarryover ? sumDaysByStatus(prevVacations, 'pending') : 0;
    const prevPermApproved = includePreviousYearForCarryover ? sumDaysByStatus(prevPermissions, 'approved') : 0;
    const prevPermPending = includePreviousYearForCarryover ? sumDaysByStatus(prevPermissions, 'pending') : 0;

    // Ausencias que descuentan vacaciones (no presentarse), según justificación.
    // Solo cuentan si están marcadas con deduct_from_vacation=true.
    const today = new Date();
    const prevEnd = new Date(`${prevYear}-12-31T23:59:59.999Z`);
    let deductedAbsenceDaysCurrent = 0;
    let deductedAbsenceDaysPrev = 0;

    const calcDeductDaysForRange = (a, rangeStart, rangeEnd) => {
        const rawStart = a && a.start_date ? new Date(a.start_date) : null;
        if (!rawStart || Number.isNaN(rawStart.getTime())) return 0;

        const rawEnd = (a && a.end_date) ? new Date(a.end_date) : rawStart;
        if (Number.isNaN(rawEnd.getTime())) return 0;

        const overlapStart = new Date(Math.max(rawStart.getTime(), rangeStart.getTime()));
        const overlapEnd = new Date(Math.min(rawEnd.getTime(), rangeEnd.getTime()));
        if (overlapEnd.getTime() < overlapStart.getTime()) return 0;

        const override = Number(a && a.deduct_vacation_days);
        // Si hay override, lo imputamos al año de inicio (caso típico: 1 día). Evita repartir overrides entre años.
        if (Number.isFinite(override) && override >= 0) {
            const startYear = rawStart.getUTCFullYear();
            const rangeYear = rangeStart.getUTCFullYear();
            return startYear === rangeYear ? override : 0;
        }

        return calendarDaysInclusive(overlapStart, overlapEnd);
    };

    for (const a of (deductibleAbsences || [])) {
        deductedAbsenceDaysCurrent += calcDeductDaysForRange(a, start, end);
        if (includePreviousYearForCarryover) {
            deductedAbsenceDaysPrev += calcDeductDaysForRange(a, prevStart, prevEnd);
        }
    }

    return {
        year,
        employee_id: String(employeeId),
        vacation: {
            allowance_days: null,
            base_allowance_days: null,
            carryover_days: 0,
            previous_year_unused_days: 0,
            policy: null,
            approved_days: vacationApproved,
            pending_days: vacationPending,
            rejected_days: vacationRejected,
            remaining_after_approved: null,
            remaining_after_pending: null
        },
        permissions: {
            approved_days: permApproved,
            pending_days: permPending,
            rejected_days: permRejected
        },
        absences: {
            deducted_days: deductedAbsenceDaysCurrent
        },
        previous_year: includePreviousYearForCarryover ? {
            year: prevYear,
            vacation: {
                approved_days: prevVacationApproved,
                pending_days: prevVacationPending
            },
            permissions: {
                approved_days: prevPermApproved,
                pending_days: prevPermPending
            },
            absences: {
                deducted_days: deductedAbsenceDaysPrev
            }
        } : null
    };
}

// Saldo de vacaciones/permisos por empleado (por año)
router.get('/balance', async (req, res) => {
    try {
        const { employee_id } = req.query;
        if (!employee_id) {
            return res.status(400).json({ error: 'employee_id es requerido' });
        }

        if (!isEmployeeUser(req.user)) {
            const hasAccess = await requireFeatureAccess(req, res, 'vacations');
            if (!hasAccess) return;
        } else {
            if (!ensureEmployeeLinked(req, res)) return;
            if (!ensureSelfEmployee(req, res, employee_id)) return;
        }

        const year = parseYear(req.query.year);
        const employee = isEmployeeUser(req.user)
            ? await Employee.findById(employee_id).lean()
            : await getEmployeeInScope(req, res, employee_id);
        if (!employee) return;

        const settings = await getSettingsForAccess();
        const policy = normalizeVacationPolicy(settings && settings.vacation_policy ? settings.vacation_policy : null);

        // El carryover ahora es manual por empleado (Mongo): Employee.vacation_carryover_days
        // Para mantener compatibilidad, seguimos devolviendo policy y previous_year_unused_days (informativo).
        const balance = await buildTimeOffBalanceForEmployee(employee_id, year, {
            includePreviousYearForCarryover: false
        });

        const baseAllowanceDays = computeProratedAnnualAllowanceDays(employee, year, policy);
        const carryoverDays = Math.max(0, Number(employee && employee.vacation_carryover_days) || 0);

        // Informativo: días no usados del año anterior según consumo imputado (sin tope/carryover-policy).
        let previousYearUnusedDays = 0;
        try {
            const prevYear = year - 1;
            const prevBalance = await buildTimeOffBalanceForEmployee(employee_id, prevYear, { includePreviousYearForCarryover: false });
            const prevAllowanceDays = computeProratedAnnualAllowanceDays(employee, prevYear, policy);
            const prevAbsDeducted = prevBalance && prevBalance.absences ? (Number(prevBalance.absences.deducted_days) || 0) : 0;
            const prevApproved = (Number(prevBalance.vacation.approved_days) || 0)
                + (Number(prevBalance.permissions.approved_days) || 0)
                + prevAbsDeducted;
            previousYearUnusedDays = Math.max(0, prevAllowanceDays - prevApproved);
        } catch (e) {
            // no-op: mantenemos 0 si falla
        }

        const allowanceDays = baseAllowanceDays + carryoverDays;
        balance.vacation.policy = {
            proration_enabled: policy.proration_enabled,
            proration_rounding_increment: policy.proration_rounding_increment,
            carryover_enabled: policy.carryover_enabled,
            carryover_max_days: policy.carryover_max_days,
            carryover_expiry_month_day: policy.carryover_expiry_month_day
        };
        balance.vacation.base_allowance_days = baseAllowanceDays;
        balance.vacation.carryover_days = carryoverDays;
        
        // carryover_total_days = días de carryover disponibles actualmente
        // El campo vacation_carryover_days del empleado YA representa los días disponibles
        // (se actualiza cuando se aprueban solicitudes, no cuando están pending)
        // Por lo tanto NO debemos sumar los pending porque duplicaría el valor
        balance.vacation.carryover_total_days = carryoverDays;
        balance.vacation.previous_year_unused_days = previousYearUnusedDays;
        balance.vacation.allowance_days = allowanceDays;
        const absDeducted = balance.absences ? (Number(balance.absences.deducted_days) || 0) : 0;
        
        const approvedConsumed = (Number(balance.vacation.approved_days) || 0) + (Number(balance.permissions.approved_days) || 0) + absDeducted;
        const pendingConsumed = (Number(balance.vacation.approved_days) || 0)
            + (Number(balance.vacation.pending_days) || 0)
            + (Number(balance.permissions.approved_days) || 0)
            + (Number(balance.permissions.pending_days) || 0)
            + absDeducted;
        balance.vacation.remaining_after_approved = Math.max(0, allowanceDays - approvedConsumed);
        balance.vacation.remaining_after_pending = Math.max(0, allowanceDays - pendingConsumed);

        res.json(balance);
    } catch (error) {
        console.error('Error al obtener saldo:', error);
        res.status(500).json({ error: 'Error al obtener saldo' });
    }
});

// Saldos por año para todos los empleados en scope (útil para administración/reportes)
router.get('/balances', async (req, res) => {
    try {
        if (isEmployeeUser(req.user)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        const hasAccess = await requireFeatureAccess(req, res, 'vacations');
        if (!hasAccess) return;

        const year = parseYear(req.query.year);

        const { employee_ids, status, location } = req.query;
        const employeesQuery = {};

        // Por defecto, el endpoint histórico devolvía solo activos.
        // Mantenemos ese comportamiento si no se especifica nada.
        if (status) {
            employeesQuery.status = String(status);
        } else if (!employee_ids) {
            employeesQuery.status = 'active';
        }

        if (location) {
            employeesQuery.location = String(location);
        }

        if (employee_ids) {
            const ids = String(employee_ids)
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            // Evitar consultas excesivas por URL muy grande
            const cappedIds = ids.slice(0, 1000);
            employeesQuery._id = { $in: cappedIds };
        }

        if (isStoreCoordinator(req.user)) {
            // Para coordinadores, limitamos al scope permitido.
            if (employeesQuery._id && employeesQuery._id.$in) {
                const storeEmployeeIds = await getStoreEmployeeIds();
                const allowed = new Set((storeEmployeeIds || []).map(String));
                employeesQuery._id.$in = employeesQuery._id.$in.filter(id => allowed.has(String(id)));
            } else {
                const storeLocations = await getStoreLocations();
                employeesQuery.location = { $in: storeLocations };

                // Si además venía un location, lo intersectamos
                if (location) {
                    employeesQuery.location = { $in: storeLocations.filter(l => l === String(location)) };
                }
            }
        }

        const employees = await Employee.find(employeesQuery)
            .select('_id annual_vacation_days vacation_carryover_days full_name dni position location hire_date termination_date')
            .lean();

        const settings = await getSettingsForAccess();
        const policy = normalizeVacationPolicy(settings && settings.vacation_policy ? settings.vacation_policy : null);

        const balances = [];
        for (const e of employees) {
            const employeeId = e._id;

            const balance = await buildTimeOffBalanceForEmployee(employeeId, year, {
                includePreviousYearForCarryover: false
            });

            const baseAllowanceDays = computeProratedAnnualAllowanceDays(e, year, policy);
            const carryoverDays = Math.max(0, Number(e && e.vacation_carryover_days) || 0);

            let previousYearUnusedDays = 0;
            try {
                const prevYear = year - 1;
                const prevBalance = await buildTimeOffBalanceForEmployee(employeeId, prevYear, { includePreviousYearForCarryover: false });
                const prevAllowanceDays = computeProratedAnnualAllowanceDays(e, prevYear, policy);
                const prevAbsDeducted = prevBalance && prevBalance.absences ? (Number(prevBalance.absences.deducted_days) || 0) : 0;
                const prevApproved = (Number(prevBalance.vacation.approved_days) || 0)
                    + (Number(prevBalance.permissions.approved_days) || 0)
                    + prevAbsDeducted;
                previousYearUnusedDays = Math.max(0, prevAllowanceDays - prevApproved);
            } catch (e2) {
                // no-op
            }

            const allowanceDays = baseAllowanceDays + carryoverDays;
            balance.vacation.policy = {
                proration_enabled: policy.proration_enabled,
                proration_rounding_increment: policy.proration_rounding_increment,
                carryover_enabled: policy.carryover_enabled,
                carryover_max_days: policy.carryover_max_days,
                carryover_expiry_month_day: policy.carryover_expiry_month_day
            };
            balance.vacation.base_allowance_days = baseAllowanceDays;
            balance.vacation.carryover_days = carryoverDays;
            balance.vacation.previous_year_unused_days = previousYearUnusedDays;
            balance.vacation.allowance_days = allowanceDays;
            const absDeducted = balance.absences ? (Number(balance.absences.deducted_days) || 0) : 0;
            const approvedConsumed = (Number(balance.vacation.approved_days) || 0) + (Number(balance.permissions.approved_days) || 0) + absDeducted;
            const pendingConsumed = (Number(balance.vacation.approved_days) || 0)
                + (Number(balance.vacation.pending_days) || 0)
                + (Number(balance.permissions.approved_days) || 0)
                + (Number(balance.permissions.pending_days) || 0)
                + absDeducted;
            balance.vacation.remaining_after_approved = Math.max(0, allowanceDays - approvedConsumed);
            balance.vacation.remaining_after_pending = Math.max(0, allowanceDays - pendingConsumed);

            balance.employee = {
                id: String(e._id),
                full_name: e.full_name,
                dni: e.dni,
                position: e.position,
                location: e.location
            };

            balances.push(balance);
        }

        res.json({ year, balances });
    } catch (error) {
        console.error('Error al obtener saldos:', error);
        res.status(500).json({ error: 'Error al obtener saldos' });
    }
});

// Obtener todas las vacaciones con filtros
router.get('/', async (req, res) => {
    try {
        if (!isEmployeeUser(req.user)) {
            // vacations.html llama con type=vacation; permissions.html llama sin type y filtra en cliente.
            const featureKey = req.query && 'type' in req.query
                ? getFeatureKeyForType(req.query.type)
                : 'permissions';

            const hasAccess = await requireFeatureAccess(req, res, featureKey);
            if (!hasAccess) return;
        }

        const { employee_id, status, year, type } = req.query;
        const query = {};

        if (isEmployeeUser(req.user)) {
            if (!ensureEmployeeLinked(req, res)) return;
            if (employee_id && !ensureSelfEmployee(req, res, employee_id)) return;
            // Empleado: solo puede ver sus propias solicitudes
            query.employee_id = req.user.employee_id;
        } else if (employee_id) {
            const ok = await ensureEmployeeInScope(req, res, employee_id);
            if (!ok) return;
            query.employee_id = employee_id;
        }
        if (status) query.status = status;
        if (type) query.type = type;
        if (year) {
            query.start_date = {
                $gte: new Date(`${year}-01-01`),
                $lte: new Date(`${year}-12-31`)
            };
        }

        if (isStoreCoordinator(req.user) && !employee_id) {
            const ids = await getStoreEmployeeIds();
            query.employee_id = { $in: ids };
        }

        const vacations = await Vacation.find(query)
            .populate('employee_id', 'full_name dni position location')
            .sort({ start_date: -1 })
            .lean()
            .exec();

        // Mapear para mantener compatibilidad con el frontend (id y nombres planos)
        const formattedVacations = vacations.map(v => ({
            ...v,
            id: v._id.toString(),
            _id: v._id.toString(),
            full_name: v.employee_id?.full_name,
            dni: v.employee_id?.dni,
            position: v.employee_id?.position,
            location: v.employee_id?.location,
            employee_id: v.employee_id?._id.toString()
        }));

        res.json(formattedVacations);

    } catch (error) {
        console.error('Error al obtener vacaciones:', error);
        res.status(500).json({ error: 'Error al obtener vacaciones' });
    }
});

// Vista equipo: ausencias/vacaciones/permisos por rango y (opcional) ubicación
// GET /api/vacations/team-calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&location=TIENDA
router.get('/team-calendar', async (req, res) => {
    try {
        if (isEmployeeUser(req.user)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const hasVacAccess = await requireFeatureAccess(req, res, 'vacations');
        if (!hasVacAccess) return;

        const startRaw = req.query && req.query.start ? String(req.query.start) : '';
        const endRaw = req.query && req.query.end ? String(req.query.end) : '';
        const location = req.query && req.query.location ? String(req.query.location).trim() : '';

        let startDate = parseIsoDateOrNull(startRaw);
        let endDate = parseIsoDateOrNull(endRaw);

        // Defaults: mes actual
        if (!startDate || !endDate) {
            const now = new Date();
            const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
            startDate = startDate || first;
            endDate = endDate || last;
        }

        if (endDate.getTime() < startDate.getTime()) {
            return res.status(400).json({ error: 'La fecha fin no puede ser anterior a la fecha inicio' });
        }

        // Límite de rango para evitar respuestas enormes
        const maxDays = 62;
        const diffMs = endDate.getTime() - startDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
        if (diffDays > maxDays) {
            return res.status(400).json({ error: `Rango demasiado grande (máx. ${maxDays} días)` });
        }

        // Construir query de empleados (scope + ubicación)
        const employeesQuery = { status: { $ne: 'inactive' } };
        if (location) {
            employeesQuery.location = location;
        }

        if (isStoreCoordinator(req.user)) {
            const storeLocations = await getStoreLocations();
            if (location) {
                employeesQuery.location = { $in: storeLocations.filter(l => l === location) };
            } else {
                employeesQuery.location = { $in: storeLocations };
            }
        }

        const employees = await Employee.find(employeesQuery)
            .select('_id full_name location position')
            .lean()
            .maxTimeMS(15000);

        const employeeIds = employees.map(e => e._id);
        const employeeById = new Map(employees.map(e => [String(e._id), e]));

        if (employeeIds.length === 0) {
            return res.json({
                range: { start: toDateOnlyString(startDate), end: toDateOnlyString(endDate) },
                location: location || null,
                events: []
            });
        }

        const settings = await getSettingsForAccess();
        const coordAccess = (req.user.role === 'store_coordinator' && settings && settings.store_coordinator_access)
            ? settings.store_coordinator_access
            : null;
        const includePermissions = req.user.role === 'admin' ? true : !!(coordAccess && coordAccess.permissions);
        const includeAbsences = req.user.role === 'admin' ? true : !!(coordAccess && coordAccess.absences);

        const vacationQuery = {
            employee_id: { $in: employeeIds },
            status: { $in: ['pending', 'approved'] },
            start_date: { $lte: endDate },
            end_date: { $gte: startDate }
        };

        // Si no incluye permisos, limitamos a type=vacation
        if (!includePermissions) {
            vacationQuery.type = 'vacation';
        }

        const absenceQuery = {
            employee_id: { $in: employeeIds },
            start_date: { $lte: endDate },
            $or: [
                { end_date: { $gte: startDate } },
                { end_date: null },
                { end_date: { $exists: false } }
            ]
        };

        const [vacationItems, absenceItems] = await Promise.all([
            Vacation.find(vacationQuery).select('_id employee_id type status start_date end_date days reason').lean(),
            includeAbsences
                ? Absence.find(absenceQuery).select('_id employee_id type status start_date end_date reason notes').lean()
                : Promise.resolve([])
        ]);

        const events = [];

        for (const v of vacationItems) {
            const emp = employeeById.get(String(v.employee_id));
            const normalizedType = String(v.type || 'vacation').toLowerCase();
            events.push({
                id: String(v._id),
                kind: normalizedType === 'vacation' ? 'vacation' : 'permission',
                subtype: normalizedType,
                status: v.status || 'pending',
                start_date: v.start_date,
                end_date: v.end_date,
                days: v.days,
                reason: v.reason,
                employee: emp ? {
                    id: String(emp._id),
                    full_name: emp.full_name,
                    location: emp.location,
                    position: emp.position
                } : { id: String(v.employee_id) }
            });
        }

        for (const a of (absenceItems || [])) {
            const emp = employeeById.get(String(a.employee_id));
            events.push({
                id: String(a._id),
                kind: 'absence',
                subtype: a.type || 'other',
                status: a.status || 'active',
                start_date: a.start_date,
                end_date: a.end_date,
                reason: a.reason,
                notes: a.notes,
                employee: emp ? {
                    id: String(emp._id),
                    full_name: emp.full_name,
                    location: emp.location,
                    position: emp.position
                } : { id: String(a.employee_id) }
            });
        }

        return res.json({
            range: { start: toDateOnlyString(startDate), end: toDateOnlyString(endDate) },
            location: location || null,
            events
        });
    } catch (error) {
        console.error('Error en vista equipo (calendario):', error);
        return res.status(500).json({ error: 'Error al obtener vista equipo' });
    }
});

const { calculateVacationDays } = require('../utils/dateUtils');

// Crear solicitud de vacaciones
router.post('/', async (req, res) => {
    try {
        if (!isEmployeeUser(req.user)) {
            const featureKey = getFeatureKeyForType(req.body?.type);
            const hasAccess = await requireFeatureAccess(req, res, featureKey);
            if (!hasAccess) return;
        }

        const bodyEmployeeId = req.body?.employee_id;
        if (isEmployeeUser(req.user) && !ensureEmployeeLinked(req, res)) return;
        const employee_id = isEmployeeUser(req.user) ? req.user.employee_id : bodyEmployeeId;
        const { start_date, end_date, type, reason, vacation_year } = req.body;

        if (!employee_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const startDate = parseIsoDateOrNull(start_date);
        const endDate = parseIsoDateOrNull(end_date);
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Fechas inválidas' });
        }
        if (endDate.getTime() < startDate.getTime()) {
            return res.status(400).json({ error: 'La fecha fin no puede ser anterior a la fecha inicio' });
        }

        const employee = await Employee.findById(employee_id);
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        if (isEmployeeUser(req.user)) {
            if (!ensureSelfEmployee(req, res, employee_id)) return;
        } else {
            const ok = await ensureEmployeeInScope(req, res, employee_id);
            if (!ok) return;
        }

        // Validación: bloquear solapes con otras solicitudes/ausencias
        const overlaps = await findOverlapsForEmployee({ employeeId: employee_id, employeeLocation: employee.location, startDate, endDate, requestType: type });
        if (overlaps.vacationOverlap) {
            return res.status(409).json({ error: 'El rango se solapa con otra solicitud existente (pendiente o aprobada)' });
        }
        if (overlaps.absenceOverlap) {
            return res.status(409).json({ error: 'El rango se solapa con una baja/ausencia existente' });
        }

        // Cálculo automático de días reales (naturales menos festivos/findes según convenio)
        const days = await calculateVacationDays(startDate, endDate, employee.location);
        const computedVacationYear = deriveVacationYear({
            explicitYear: vacation_year,
            startDate,
            reason
        });

        // FIFO: primero se consumen días pendientes de otros años (carryover), luego del año en vigor.
        // 1. Contar saldo disponible de carryover (Employee.vacation_carryover_days, sin reservar)
        // 2. Contar saldo disponible del año vigente (allowance - consumo actual)
        // 3. Validar total disponible >= días solicitados
        // 4. Calcular cómo asignar: min(carryover_available, days) → carryover; resto → currentYear
        // 5. Reservar carryover inmediatamente para evitar sobre-asignación
        const settings = await getSettingsForAccess();
        const policy = normalizeVacationPolicy(settings && settings.vacation_policy ? settings.vacation_policy : null);

        const carryoverAvailable = Math.max(0, Number(employee.vacation_carryover_days) || 0);
        const yearBaseAllowance = computeProratedAnnualAllowanceDays(employee, computedVacationYear, policy);
        const yearBalance = await buildTimeOffBalanceForEmployee(employee_id, computedVacationYear, { includePreviousYearForCarryover: false });
        const absDeducted = yearBalance && yearBalance.absences ? (Number(yearBalance.absences.deducted_days) || 0) : 0;
        const pendingConsumed = (Number(yearBalance.vacation.approved_days) || 0)
            + (Number(yearBalance.vacation.pending_days) || 0)
            + (Number(yearBalance.permissions.approved_days) || 0)
            + (Number(yearBalance.permissions.pending_days) || 0)
            + absDeducted;
        const remainingCurrentYearAfterPending = Math.max(0, yearBaseAllowance - pendingConsumed);
        const totalAvailable = carryoverAvailable + remainingCurrentYearAfterPending;
        if (Number(days) > totalAvailable) {
            return res.status(409).json({
                error: `No hay saldo suficiente. Disponibles: ${totalAvailable} (Años anteriores: ${carryoverAvailable}, Año ${computedVacationYear}: ${remainingCurrentYearAfterPending})`
            });
        }

        const carryoverToUse = Math.min(carryoverAvailable, Number(days) || 0);
        const currentYearToUse = Math.max(0, (Number(days) || 0) - carryoverToUse);

        // Reservar carryover al crear la solicitud (queda trazado y evita sobre-asignación).
        const reserve = await reserveEmployeeCarryoverDays(employee_id, carryoverToUse);
        if (!reserve.ok) {
            return res.status(409).json({ error: reserve.error || 'No se pudo reservar carryover' });
        }

        const vacation = new Vacation({
            employee_id,
            vacation_year: computedVacationYear,
            start_date: startDate,
            end_date: endDate,
            days,
            allocation: {
                carryover_days: carryoverToUse,
                current_year_days: currentYearToUse
            },
            type,
            reason,
            status: 'pending'
        });

        try {
            await vacation.save();
        } catch (e) {
            // Rollback de reserva carryover si falló el guardado
            await releaseEmployeeCarryoverDays(employee_id, carryoverToUse);
            throw e;
        }

        await logAudit({
            req,
            action: 'timeoff.create',
            entityType: 'Vacation',
            entityId: String(vacation._id),
            employeeId: String(employee_id),
            employeeLocation: String(employee.location || ''),
            before: null,
            after: pick(vacation.toObject ? vacation.toObject() : vacation, ['_id', 'employee_id', 'type', 'vacation_year', 'status', 'start_date', 'end_date', 'days', 'allocation', 'reason']),
            meta: { source: isEmployeeUser(req.user) ? 'employee' : 'admin' }
        });

        res.status(201).json({ id: vacation._id, days, message: 'Solicitud creada correctamente' });

    } catch (error) {
        console.error('Error al crear solicitud:', error);
        res.status(500).json({ error: 'Error al crear solicitud' });
    }
});

// Actualizar solicitud de vacación
router.put('/:id', async (req, res) => {
    try {
        const { status, reason, start_date, end_date, type, days, vacation_year, rejection_reason, cancellation_reason, revocation_reason } = req.body;
        const update = {};

        const existing = await Vacation.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Solicitud no encontrada' });

        const employeeForAudit = await Employee.findById(existing.employee_id).select('location').lean();
        const employeeLocationForAudit = employeeForAudit && employeeForAudit.location ? String(employeeForAudit.location) : '';

        const beforeSnapshot = pick(existing.toObject(), ['_id', 'employee_id', 'type', 'vacation_year', 'status', 'start_date', 'end_date', 'days', 'allocation', 'reason', 'rejection_reason', 'cancellation_reason', 'revocation_reason']);

        if (isEmployeeUser(req.user)) {
            if (!ensureSelfEmployee(req, res, existing.employee_id)) return;

            // Empleado: puede cancelar si está pendiente; si no, solo editar campos si está pendiente.
            if (status) {
                if (String(status) !== 'cancelled') {
                    return res.status(403).json({ error: 'No tienes permiso para cambiar el estado' });
                }
                if (existing.status !== 'pending') {
                    return res.status(403).json({ error: 'Solo puedes cancelar solicitudes pendientes' });
                }

                // Liberar carryover reservado
                const reservedCarry = existing.allocation ? (Number(existing.allocation.carryover_days) || 0) : 0;
                await releaseEmployeeCarryoverDays(existing.employee_id, reservedCarry);

                update.status = 'cancelled';
                update.cancelled_by = req.user.id;
                update.cancelled_date = new Date();
                if (cancellation_reason !== undefined) update.cancellation_reason = cancellation_reason;

                const vacation = await Vacation.findByIdAndUpdate(req.params.id, update, { new: true });

                await logAudit({
                    req,
                    action: 'timeoff.cancel',
                    entityType: 'Vacation',
                    entityId: String(existing._id),
                    employeeId: String(existing.employee_id),
                    employeeLocation: employeeLocationForAudit,
                    before: beforeSnapshot,
                    after: pick(vacation && vacation.toObject ? vacation.toObject() : vacation, ['_id', 'employee_id', 'type', 'status', 'start_date', 'end_date', 'days', 'allocation', 'reason', 'cancellation_reason']),
                    meta: { by_role: req.user && req.user.role ? req.user.role : 'employee' }
                });

                return res.json({ message: 'Solicitud cancelada correctamente', vacation });
            }

            if (existing.status !== 'pending') {
                return res.status(403).json({ error: 'Solo puedes modificar solicitudes pendientes' });
            }

            if (start_date) update.start_date = start_date;
            if (end_date) update.end_date = end_date;
            if (type) update.type = type;
            if (reason !== undefined) update.reason = reason;
            if (vacation_year !== undefined) update.vacation_year = vacation_year;

            // Recalcular días si cambia rango (no confiar en el cliente)
            if (start_date || end_date) {
                const employee = await Employee.findById(existing.employee_id).select('location').lean();
                if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });
                const newStart = parseIsoDateOrNull(update.start_date || existing.start_date);
                const newEnd = parseIsoDateOrNull(update.end_date || existing.end_date);
                if (!newStart || !newEnd) return res.status(400).json({ error: 'Fechas inválidas' });
                if (newEnd.getTime() < newStart.getTime()) return res.status(400).json({ error: 'La fecha fin no puede ser anterior a la fecha inicio' });

                const overlaps = await findOverlapsForEmployee({
                    employeeId: existing.employee_id,
                    employeeLocation: employee.location,
                    startDate: newStart,
                    endDate: newEnd,
                    requestType: update.type || existing.type,
                    excludeVacationId: existing._id
                });
                if (overlaps.vacationOverlap) {
                    return res.status(409).json({ error: 'El rango se solapa con otra solicitud existente (pendiente o aprobada)' });
                }
                if (overlaps.absenceOverlap) {
                    return res.status(409).json({ error: 'El rango se solapa con una baja/ausencia existente' });
                }

                update.days = await calculateVacationDays(newStart, newEnd, employee.location);

                // Si no se indicó explícitamente, mantener o derivar el año contable
                if (vacation_year === undefined) {
                    update.vacation_year = existing.vacation_year ?? deriveVacationYear({
                        explicitYear: null,
                        startDate: newStart,
                        reason: (reason !== undefined ? reason : existing.reason)
                    });
                }
            }

            // Recalcular asignación FIFO si sigue pendiente (editar afecta reserva)
            if (existing.status === 'pending' && (start_date || end_date || days || vacation_year !== undefined || reason !== undefined)) {
                const oldCarry = existing.allocation ? (Number(existing.allocation.carryover_days) || 0) : 0;
                const oldCurrentYear = existing.allocation ? (Number(existing.allocation.current_year_days) || 0) : (Number(existing.days) || 0);
                // Devolver reserva anterior antes de recalcular
                await releaseEmployeeCarryoverDays(existing.employee_id, oldCarry);

                const employee = await Employee.findById(existing.employee_id).select('vacation_carryover_days annual_vacation_days hire_date termination_date location').lean();
                if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

                const effectiveStart = parseIsoDateOrNull(update.start_date || existing.start_date);
                const effectiveEnd = parseIsoDateOrNull(update.end_date || existing.end_date);
                const computedYear = deriveVacationYear({
                    explicitYear: (update.vacation_year !== undefined ? update.vacation_year : existing.vacation_year),
                    startDate: effectiveStart,
                    reason: (update.reason !== undefined ? update.reason : existing.reason)
                });

                const settings = await getSettingsForAccess();
                const policy = normalizeVacationPolicy(settings && settings.vacation_policy ? settings.vacation_policy : null);
                const carryoverAvailable = Math.max(0, Number(employee.vacation_carryover_days) || 0);
                const yearBaseAllowance = computeProratedAnnualAllowanceDays(employee, computedYear, policy);
                const yearBalance = await buildTimeOffBalanceForEmployee(existing.employee_id, computedYear, { includePreviousYearForCarryover: false });
                const absDeducted = yearBalance && yearBalance.absences ? (Number(yearBalance.absences.deducted_days) || 0) : 0;

                // yearBalance incluye esta solicitud (pendiente) con allocation previa. 
                // Descontamos su aporte previo al año vigente (oldCurrentYear) para evitar doble contabilidad.
                const approvedConsumption = (Number(yearBalance.vacation.approved_days) || 0)
                    + (Number(yearBalance.permissions.approved_days) || 0)
                    + absDeducted;
                const pendingOthers = (Number(yearBalance.vacation.pending_days) || 0)
                    + (Number(yearBalance.permissions.pending_days) || 0)
                    - (Number(existing.days) || 0); // Restar ESTA solicitud pendiente para evitar doble conteo
                const consumedCurrentYear = approvedConsumption + pendingOthers + oldCurrentYear;
                const remainingCurrentYearAfterPending = Math.max(0, yearBaseAllowance - consumedCurrentYear);

                const newTotalDays = Number(update.days !== undefined ? update.days : existing.days) || 0;
                const totalAvailable = carryoverAvailable + remainingCurrentYearAfterPending;
                if (newTotalDays > totalAvailable) {
                    // Volver a reservar lo anterior para no dejar el carryover inflado
                    await reserveEmployeeCarryoverDays(existing.employee_id, oldCarry);
                    return res.status(409).json({
                        error: `No hay saldo suficiente tras el cambio. Disponibles: ${totalAvailable} (Años anteriores: ${carryoverAvailable}, Año ${computedYear}: ${remainingCurrentYearAfterPending})`
                    });
                }

                const carryoverToUse = Math.min(carryoverAvailable, newTotalDays);
                const currentYearToUse = Math.max(0, newTotalDays - carryoverToUse);

                const reserve = await reserveEmployeeCarryoverDays(existing.employee_id, carryoverToUse);
                if (!reserve.ok) {
                    // Volver a reservar lo anterior
                    await reserveEmployeeCarryoverDays(existing.employee_id, oldCarry);
                    return res.status(409).json({ error: reserve.error || 'No se pudo reservar carryover' });
                }

                update.allocation = {
                    carryover_days: carryoverToUse,
                    current_year_days: currentYearToUse
                };
            }
        } else {
            // Si se envía status, es una decisión (aprobación/rechazo/cancelación/revocación)
            if (status) {
                const newStatus = String(status);
                if (!canTransitionStatus(existing.status, newStatus)) {
                    return res.status(400).json({ error: `Transición de estado no permitida (${existing.status} → ${newStatus})` });
                }

                if (newStatus === 'rejected') {
                    const rr = (rejection_reason == null ? '' : String(rejection_reason)).trim();
                    if (!rr) {
                        return res.status(400).json({ error: 'El motivo de rechazo es obligatorio' });
                    }
                    update.status = 'rejected';
                    update.rejection_reason = rr;
                    update.rejected_by = req.user.id;
                    update.rejected_date = new Date();

                    // Rechazo de una pendiente: liberar carryover reservado
                    if (existing.status === 'pending') {
                        const reservedCarry = existing.allocation ? (Number(existing.allocation.carryover_days) || 0) : 0;
                        await releaseEmployeeCarryoverDays(existing.employee_id, reservedCarry);
                    }
                } else if (newStatus === 'approved') {
                    update.status = 'approved';
                    update.approved_by = req.user.id;
                    update.approved_date = new Date();

                    // Compatibilidad: si la solicitud no tiene allocation (legacy), la calculamos al aprobar.
                    const hasAllocation = existing.allocation && (Number(existing.allocation.carryover_days) || 0) + (Number(existing.allocation.current_year_days) || 0) > 0;
                    if (!hasAllocation) {
                        const employee = await Employee.findById(existing.employee_id).select('vacation_carryover_days annual_vacation_days hire_date termination_date location').lean();
                        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

                        const computedYear = deriveVacationYear({
                            explicitYear: existing.vacation_year,
                            startDate: existing.start_date,
                            reason: existing.reason
                        });

                        const settings = await getSettingsForAccess();
                        const policy = normalizeVacationPolicy(settings && settings.vacation_policy ? settings.vacation_policy : null);
                        const carryoverAvailable = Math.max(0, Number(employee.vacation_carryover_days) || 0);
                        const yearBaseAllowance = computeProratedAnnualAllowanceDays(employee, computedYear, policy);
                        const yearBalance = await buildTimeOffBalanceForEmployee(existing.employee_id, computedYear, { includePreviousYearForCarryover: false });
                        const absDeducted = yearBalance && yearBalance.absences ? (Number(yearBalance.absences.deducted_days) || 0) : 0;
                        const approvedConsumed = (Number(yearBalance.vacation.approved_days) || 0)
                            + (Number(yearBalance.permissions.approved_days) || 0)
                            + absDeducted;
                        const remainingCurrentYearAfterApproved = Math.max(0, yearBaseAllowance - approvedConsumed);

                        const totalDays = Number(existing.days) || 0;
                        const totalAvailable = carryoverAvailable + remainingCurrentYearAfterApproved;
                        if (totalDays > totalAvailable) {
                            return res.status(409).json({
                                error: `No hay saldo suficiente para aprobar. Disponibles: ${totalAvailable} (Años anteriores: ${carryoverAvailable}, Año ${computedYear}: ${remainingCurrentYearAfterApproved})`
                            });
                        }

                        const carryoverToUse = Math.min(carryoverAvailable, totalDays);
                        const currentYearToUse = Math.max(0, totalDays - carryoverToUse);
                        const reserve = await reserveEmployeeCarryoverDays(existing.employee_id, carryoverToUse);
                        if (!reserve.ok) {
                            return res.status(409).json({ error: reserve.error || 'No se pudo reservar carryover' });
                        }

                        update.allocation = {
                            carryover_days: carryoverToUse,
                            current_year_days: currentYearToUse
                        };
                    }
                } else if (newStatus === 'cancelled') {
                    update.status = 'cancelled';
                    update.cancelled_by = req.user.id;
                    update.cancelled_date = new Date();
                    if (cancellation_reason !== undefined) update.cancellation_reason = cancellation_reason;

                    // Cancelación admin de una pendiente: liberar carryover reservado
                    if (existing.status === 'pending') {
                        const reservedCarry = existing.allocation ? (Number(existing.allocation.carryover_days) || 0) : 0;
                        await releaseEmployeeCarryoverDays(existing.employee_id, reservedCarry);
                    }
                } else if (newStatus === 'revoked') {
                    update.status = 'revoked';
                    update.revoked_by = req.user.id;
                    update.revoked_date = new Date();
                    if (revocation_reason !== undefined) update.revocation_reason = revocation_reason;

                    // Revocación (aprobada -> revocada): devolver carryover consumido
                    if (existing.status === 'approved') {
                        const reservedCarry = existing.allocation ? (Number(existing.allocation.carryover_days) || 0) : 0;
                        await releaseEmployeeCarryoverDays(existing.employee_id, reservedCarry);
                    }
                }
            }

            const featureKey = getFeatureKeyForType(existing.type);
            const hasAccess = await requireFeatureAccess(req, res, featureKey);
            if (!hasAccess) return;

            const ok = await ensureEmployeeInScope(req, res, existing.employee_id);
            if (!ok) return;

            // Edición de fechas/días: solo si está pendiente (evitar cambios retroactivos en aprobadas)
            if (existing.status === 'pending') {
                if (start_date) update.start_date = start_date;
                if (end_date) update.end_date = end_date;
                if (type) update.type = type;
                if (reason !== undefined) update.reason = reason;
                if (vacation_year !== undefined) update.vacation_year = vacation_year;

                if (start_date || end_date) {
                    const employee = await Employee.findById(existing.employee_id).select('location').lean();
                    if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });
                    const newStart = parseIsoDateOrNull(update.start_date || existing.start_date);
                    const newEnd = parseIsoDateOrNull(update.end_date || existing.end_date);
                    if (!newStart || !newEnd) return res.status(400).json({ error: 'Fechas inválidas' });
                    if (newEnd.getTime() < newStart.getTime()) return res.status(400).json({ error: 'La fecha fin no puede ser anterior a la fecha inicio' });

                    const overlaps = await findOverlapsForEmployee({
                        employeeId: existing.employee_id,
                        employeeLocation: employee.location,
                        startDate: newStart,
                        endDate: newEnd,
                        requestType: update.type || existing.type,
                        excludeVacationId: existing._id
                    });
                    if (overlaps.vacationOverlap) {
                        return res.status(409).json({ error: 'El rango se solapa con otra solicitud existente (pendiente o aprobada)' });
                    }
                    if (overlaps.absenceOverlap) {
                        return res.status(409).json({ error: 'El rango se solapa con una baja/ausencia existente' });
                    }

                    update.days = await calculateVacationDays(newStart, newEnd, employee.location);

                    if (vacation_year === undefined) {
                        update.vacation_year = existing.vacation_year ?? deriveVacationYear({
                            explicitYear: null,
                            startDate: newStart,
                            reason: (reason !== undefined ? reason : existing.reason)
                        });
                    }
                } else if (days) {
                    // Permitir override explícito si no cambia fechas (mantener comportamiento existente)
                    update.days = days;
                }

                // Recalcular asignación FIFO si sigue pendiente (editar afecta reserva)
                if (existing.status === 'pending' && (start_date || end_date || days || vacation_year !== undefined || reason !== undefined)) {
                    const oldCarry = existing.allocation ? (Number(existing.allocation.carryover_days) || 0) : 0;
                    // Devolver reserva anterior antes de recalcular
                    await releaseEmployeeCarryoverDays(existing.employee_id, oldCarry);

                    const employee = await Employee.findById(existing.employee_id).select('vacation_carryover_days annual_vacation_days hire_date termination_date location').lean();
                    if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

                    const effectiveStart = parseIsoDateOrNull(update.start_date || existing.start_date);
                    const effectiveEnd = parseIsoDateOrNull(update.end_date || existing.end_date);
                    const computedYear = deriveVacationYear({
                        explicitYear: (update.vacation_year !== undefined ? update.vacation_year : existing.vacation_year),
                        startDate: effectiveStart,
                        reason: (update.reason !== undefined ? update.reason : existing.reason)
                    });

                    const settings = await getSettingsForAccess();
                    const policy = normalizeVacationPolicy(settings && settings.vacation_policy ? settings.vacation_policy : null);
                    const carryoverAvailable = Math.max(0, Number(employee.vacation_carryover_days) || 0);
                    const yearBaseAllowance = computeProratedAnnualAllowanceDays(employee, computedYear, policy);
                    const yearBalance = await buildTimeOffBalanceForEmployee(existing.employee_id, computedYear, { includePreviousYearForCarryover: false });
                    const absDeducted = yearBalance && yearBalance.absences ? (Number(yearBalance.absences.deducted_days) || 0) : 0;

                    // OJO: yearBalance incluye esta misma solicitud con la asignación previa (que ya hemos devuelto).
                    // Para evitar doble contabilidad, restamos su impacto previo (current_year_days).
                    const prevCurrent = existing.allocation ? (Number(existing.allocation.current_year_days) || 0) : (Number(existing.days) || 0);
                    const pendingConsumed = (Number(yearBalance.vacation.approved_days) || 0)
                        + (Number(yearBalance.vacation.pending_days) || 0)
                        + (Number(yearBalance.permissions.approved_days) || 0)
                        + (Number(yearBalance.permissions.pending_days) || 0)
                        + absDeducted
                        - prevCurrent;
                    const remainingCurrentYearAfterPending = Math.max(0, yearBaseAllowance - pendingConsumed);

                    const newTotalDays = Number(update.days !== undefined ? update.days : existing.days) || 0;
                    const totalAvailable = carryoverAvailable + remainingCurrentYearAfterPending;
                    if (newTotalDays > totalAvailable) {
                        // Volver a reservar lo anterior para no dejar el carryover inflado
                        await reserveEmployeeCarryoverDays(existing.employee_id, oldCarry);
                        return res.status(409).json({
                            error: `No hay saldo suficiente tras el cambio. Disponibles: ${totalAvailable} (Años anteriores: ${carryoverAvailable}, Año ${computedYear}: ${remainingCurrentYearAfterPending})`
                        });
                    }

                    const carryoverToUse = Math.min(carryoverAvailable, newTotalDays);
                    const currentYearToUse = Math.max(0, newTotalDays - carryoverToUse);

                    const reserve = await reserveEmployeeCarryoverDays(existing.employee_id, carryoverToUse);
                    if (!reserve.ok) {
                        // Volver a reservar lo anterior
                        await reserveEmployeeCarryoverDays(existing.employee_id, oldCarry);
                        return res.status(409).json({ error: reserve.error || 'No se pudo reservar carryover' });
                    }

                    update.allocation = {
                        carryover_days: carryoverToUse,
                        current_year_days: currentYearToUse
                    };
                }
            }
        }

        const vacation = await Vacation.findByIdAndUpdate(req.params.id, update, { new: true });

        const afterSnapshot = pick(vacation && vacation.toObject ? vacation.toObject() : vacation, ['_id', 'employee_id', 'type', 'vacation_year', 'status', 'start_date', 'end_date', 'days', 'allocation', 'reason', 'rejection_reason', 'cancellation_reason', 'revocation_reason']);
        const changed = shallowDiff(beforeSnapshot, afterSnapshot);

        let auditAction = 'timeoff.update';
        if (beforeSnapshot.status !== afterSnapshot.status) {
            if (afterSnapshot.status === 'approved') auditAction = 'timeoff.approve';
            else if (afterSnapshot.status === 'rejected') auditAction = 'timeoff.reject';
            else if (afterSnapshot.status === 'cancelled') auditAction = 'timeoff.cancel';
            else if (afterSnapshot.status === 'revoked') auditAction = 'timeoff.revoke';
            else auditAction = 'timeoff.status_change';
        }

        await logAudit({
            req,
            action: auditAction,
            entityType: 'Vacation',
            entityId: String(existing._id),
            employeeId: String(existing.employee_id),
            employeeLocation: employeeLocationForAudit,
            before: beforeSnapshot,
            after: afterSnapshot,
            meta: { changed }
        });

        res.json({ message: 'Solicitud actualizada correctamente', vacation });

    } catch (error) {
        console.error('Error al actualizar solicitud:', error);
        res.status(500).json({ error: 'Error al actualizar solicitud' });
    }
});

// Obtener una solicitud por ID
router.get('/:id', async (req, res) => {
    try {
        const vacation = await Vacation.findById(req.params.id).populate('employee_id');
        if (!vacation) return res.status(404).json({ error: 'Solicitud no encontrada' });

        if (isEmployeeUser(req.user)) {
            if (!ensureSelfEmployee(req, res, vacation.employee_id?._id)) return;
        } else {
            const featureKey = getFeatureKeyForType(vacation.type);
            const hasAccess = await requireFeatureAccess(req, res, featureKey);
            if (!hasAccess) return;

            const ok = await ensureEmployeeInScope(req, res, vacation.employee_id?._id);
            if (!ok) return;
        }

        res.json({
            ...vacation._doc,
            id: vacation._id,
            full_name: vacation.employee_id?.full_name,
            dni: vacation.employee_id?.dni,
            position: vacation.employee_id?.position,
            location: vacation.employee_id?.location
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener solicitud' });
    }
});

// Eliminar solicitud
router.delete('/:id', async (req, res) => {
    try {
        const existing = await Vacation.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Solicitud no encontrada' });

        if (isEmployeeUser(req.user)) {
            if (!ensureSelfEmployee(req, res, existing.employee_id)) return;
            if (existing.status !== 'pending') {
                return res.status(403).json({ error: 'Solo puedes eliminar solicitudes pendientes' });
            }
        } else {
            const featureKey = getFeatureKeyForType(existing.type);
            const hasAccess = await requireFeatureAccess(req, res, featureKey);
            if (!hasAccess) return;

            const ok = await ensureEmployeeInScope(req, res, existing.employee_id);
            if (!ok) return;
        }

        if (existing.status === 'pending') {
            const reservedCarry = existing.allocation ? (Number(existing.allocation.carryover_days) || 0) : 0;
            await releaseEmployeeCarryoverDays(existing.employee_id, reservedCarry);
        }

        await Vacation.findByIdAndDelete(req.params.id);
        res.json({ message: 'Solicitud eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar solicitud' });
    }
});

module.exports = router;
