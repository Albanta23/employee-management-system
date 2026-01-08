const mongoose = require('mongoose');

const Settings = require('../models/Settings');
const Employee = require('../models/Employee');
const Vacation = require('../models/Vacation');
const Absence = require('../models/Absence');
const AuditLog = require('../models/AuditLog');

function normalizeVacationPolicy(input) {
    const out = {
        proration_enabled: false,
        proration_rounding_increment: 0.5
    };

    if (!input || typeof input !== 'object') return out;
    if (Object.prototype.hasOwnProperty.call(input, 'proration_enabled')) out.proration_enabled = !!input.proration_enabled;

    const inc = Number(input.proration_rounding_increment);
    if (Number.isFinite(inc) && inc > 0) out.proration_rounding_increment = inc;

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

    if (hireDate) employedStart = clampDateToRange(hireDate, yearStart, yearEnd);
    if (terminationDate) employedEnd = clampDateToRange(terminationDate, yearStart, yearEnd);

    const totalDaysInYear = diffDaysInclusiveUtc(yearStart, yearEnd);
    const employedDays = diffDaysInclusiveUtc(employedStart, employedEnd);
    if (totalDaysInYear <= 0 || employedDays <= 0) return 0;

    const raw = annualDays * (employedDays / totalDaysInYear);
    const rounded = roundToIncrement(raw, policy.proration_rounding_increment);
    return Math.max(0, Math.min(annualDays, rounded));
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

function calcDeductDaysForYear(absence, yearStart, yearEnd, targetYear) {
    const rawStart = absence && absence.start_date ? new Date(absence.start_date) : null;
    if (!rawStart || Number.isNaN(rawStart.getTime())) return 0;

    const rawEnd = (absence && absence.end_date) ? new Date(absence.end_date) : rawStart;
    if (Number.isNaN(rawEnd.getTime())) return 0;

    const overlapStart = new Date(Math.max(rawStart.getTime(), yearStart.getTime()));
    const overlapEnd = new Date(Math.min(rawEnd.getTime(), yearEnd.getTime()));
    if (overlapEnd.getTime() < overlapStart.getTime()) return 0;

    const override = Number(absence && absence.deduct_vacation_days);
    if (Number.isFinite(override) && override >= 0) {
        // Si hay override, asumimos que se imputa al año de inicio de la ausencia.
        const startYear = rawStart.getUTCFullYear();
        return startYear === targetYear ? override : 0;
    }

    return calendarDaysInclusive(overlapStart, overlapEnd);
}

function normalizeActor(actor) {
    if (!actor) return { user_id: null, username: 'system', role: 'system' };
    return {
        user_id: actor.user_id != null ? actor.user_id : null,
        username: String(actor.username || 'system'),
        role: String(actor.role || 'system')
    };
}

/**
 * Ejecuta el rollover de vacaciones para el año indicado.
 *
 * - Calcula días no consumidos del año (vacaciones aprobadas imputadas al año + ausencias que descuentan).
 * - Suma al Employee.vacation_carryover_days.
 * - Marca Settings.vacation_carryover_last_rollover_year.
 * - Genera AuditLog por empleado afectado.
 */
async function runVacationRollover({ targetYear, dryRun = false, force = false, actor = null } = {}) {
    const year = Number(targetYear);
    if (!Number.isFinite(year)) {
        throw new Error('targetYear inválido');
    }

    // Settings singleton
    let settingsDoc = await Settings.findOne({});
    if (!settingsDoc) settingsDoc = new Settings();

    const last = Number(settingsDoc.vacation_carryover_last_rollover_year);
    if (!force && Number.isFinite(last) && last === year) {
        return {
            ok: true,
            skipped: true,
            year,
            message: `Ya existe rollover registrado para ${year}.`,
            updatedEmployees: 0,
            totalAddedDays: 0
        };
    }

    const policy = normalizeVacationPolicy(settingsDoc.vacation_policy);

    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    // 1) Empleados
    const employees = await Employee.find({ status: { $ne: 'inactive' } })
        .select('_id full_name location status annual_vacation_days vacation_carryover_days hire_date termination_date')
        .lean();

    const employeeById = new Map();
    for (const e of employees) employeeById.set(String(e._id), e);

    // 2) Vacaciones aprobadas imputadas a ese año
    const vacations = await Vacation.find({
        status: 'approved',
        type: 'vacation',
        $or: [
            { vacation_year: year },
            { vacation_year: { $exists: false }, start_date: { $gte: yearStart, $lte: yearEnd } }
        ]
    }).select('employee_id days allocation vacation_year start_date').lean();

    const approvedByEmployeeId = new Map();
    for (const v of (vacations || [])) {
        const empId = String(v.employee_id);
        const current = v && v.allocation && Number.isFinite(Number(v.allocation.current_year_days))
            ? Number(v.allocation.current_year_days)
            : (Number(v.days) || 0);
        const prev = approvedByEmployeeId.get(empId) || 0;
        approvedByEmployeeId.set(empId, prev + Math.max(0, current));
    }

    // 3) Ausencias que descuentan
    const absences = await Absence.find({
        deduct_from_vacation: true,
        start_date: { $lte: yearEnd },
        $or: [
            { end_date: { $gte: yearStart } },
            { end_date: null },
            { end_date: { $exists: false } }
        ]
    }).select('employee_id start_date end_date deduct_vacation_days').lean();

    const absDeductByEmployeeId = new Map();
    for (const a of (absences || [])) {
        const empId = String(a.employee_id);
        const add = calcDeductDaysForYear(a, yearStart, yearEnd, year);
        if (add <= 0) continue;
        const prev = absDeductByEmployeeId.get(empId) || 0;
        absDeductByEmployeeId.set(empId, prev + add);
    }

    // 4) Aplicar cambios
    let updatedEmployees = 0;
    let totalAddedDays = 0;

    const actorDoc = normalizeActor(actor);

    const bulkOps = [];
    const auditDocs = [];

    for (const emp of employees) {
        const empId = String(emp._id);
        const baseAllowance = computeProratedAnnualAllowanceDays(emp, year, policy);
        const approvedConsumed = approvedByEmployeeId.get(empId) || 0;
        const absDeducted = absDeductByEmployeeId.get(empId) || 0;

        const unused = Math.max(0, baseAllowance - (approvedConsumed + absDeducted));
        if (!Number.isFinite(unused) || unused <= 0) continue;

        totalAddedDays += unused;
        updatedEmployees += 1;

        if (!dryRun) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: emp._id },
                    update: { $inc: { vacation_carryover_days: unused } }
                }
            });

            auditDocs.push({
                actor: {
                    user_id: actorDoc.user_id,
                    username: actorDoc.username,
                    role: actorDoc.role
                },
                action: 'vacation_rollover',
                entity: { type: 'employee', id: empId },
                employee: { id: empId, location: String(emp.location || '') },
                before: { vacation_carryover_days: Number(emp.vacation_carryover_days || 0) },
                after: { vacation_carryover_days: Number(emp.vacation_carryover_days || 0) + unused },
                meta: {
                    year,
                    added_days: unused,
                    base_allowance_days: baseAllowance,
                    approved_consumed_days: approvedConsumed,
                    absences_deducted_days: absDeducted
                }
            });
        }
    }

    if (!dryRun) {
        if (bulkOps.length) {
            await Employee.bulkWrite(bulkOps, { ordered: false });
        }
        if (auditDocs.length) {
            await AuditLog.insertMany(auditDocs, { ordered: false });
        }

        settingsDoc.vacation_carryover_last_rollover_year = year;
        settingsDoc.updated_at = new Date();
        await settingsDoc.save();
    }

    return {
        ok: true,
        skipped: false,
        year,
        updatedEmployees,
        totalAddedDays
    };
}

module.exports = {
    runVacationRollover
};
