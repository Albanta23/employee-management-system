const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, isAdmin, getStoreLocations } = require('../utils/accessScope');

const Vacation = require('../models/Vacation');
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');

router.use(authenticateToken);

function parseISODate(value) {
    const s = (value == null ? '' : String(value)).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function daysInclusive(a, b) {
    const start = startOfDay(a);
    const end = startOfDay(b);
    const ms = end.getTime() - start.getTime();
    if (ms < 0) return 0;
    return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

function overlapDaysInclusive(start, end, rangeStart, rangeEnd) {
    const s = start > rangeStart ? start : rangeStart;
    const e = end < rangeEnd ? end : rangeEnd;
    return daysInclusive(s, e);
}

function buildRangeFromQuery(query) {
    const year = (query && query.year != null) ? String(query.year).trim() : '';
    if (year && /^\d{4}$/.test(year)) {
        const y = Number(year);
        const start = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
        const end = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
        return { start, end };
    }

    const startRaw = parseISODate(query && query.start_date);
    const endRaw = parseISODate(query && query.end_date);

    if (startRaw && endRaw) {
        return { start: startOfDay(startRaw), end: endOfDay(endRaw) };
    }

    // Default: año actual
    const now = new Date();
    const y = now.getFullYear();
    const start = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
    return { start, end };
}

async function getAllowedLocationsForUser(req) {
    if (isAdmin(req.user)) return null;
    return await getStoreLocations();
}

function ensureLocationAllowed(res, location, allowedLocations) {
    if (!location) return true;
    if (!allowedLocations) return true;

    if (!allowedLocations.includes(String(location))) {
        res.status(403).json({ error: 'Acceso denegado a esta ubicación' });
        return false;
    }
    return true;
}

function withMaxTime(cursorLike, ms) {
    const maxMs = Number(ms);
    if (!Number.isFinite(maxMs) || maxMs <= 0) return cursorLike;

    // Mongoose Query (find/findOne/etc.)
    if (cursorLike && typeof cursorLike.setOptions === 'function') {
        return cursorLike.setOptions({ maxTimeMS: maxMs });
    }

    // Mongoose Aggregate
    if (cursorLike && typeof cursorLike.option === 'function') {
        return cursorLike.option({ maxTimeMS: maxMs });
    }

    // Algunas versiones exponen maxTimeMS directamente
    if (cursorLike && typeof cursorLike.maxTimeMS === 'function') {
        return cursorLike.maxTimeMS(maxMs);
    }

    return cursorLike;
}

// GET /api/reports/vacation-consumption?year=2025&location=&type=
router.get('/vacation-consumption', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'reports');
        if (!hasAccess) return;

        const { start, end } = buildRangeFromQuery(req.query);
        const location = (req.query && req.query.location != null) ? String(req.query.location).trim() : '';
        const typeRaw = (req.query && req.query.type != null) ? String(req.query.type).trim() : '';
        const type = typeRaw || 'vacation';

        const allowedLocations = await getAllowedLocationsForUser(req);
        const okLoc = ensureLocationAllowed(res, location, allowedLocations);
        if (!okLoc) return;

        const employeeLocationMatch = location
            ? { 'employee.location': location }
            : allowedLocations
                ? { 'employee.location': { $in: allowedLocations } }
                : {};

        const match = {
            start_date: { $gte: start, $lte: end },
            status: { $in: ['approved', 'pending'] }
        };

        if (type !== 'all') {
            match.type = type;
        }

        const rows = await withMaxTime(Vacation.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: 'employees',
                    localField: 'employee_id',
                    foreignField: '_id',
                    as: 'employee'
                }
            },
            { $unwind: '$employee' },
            {
                $match: {
                    'employee.status': { $ne: 'inactive' },
                    ...employeeLocationMatch
                }
            },
            {
                $group: {
                    _id: '$employee._id',
                    full_name: { $first: '$employee.full_name' },
                    dni: { $first: '$employee.dni' },
                    location: { $first: '$employee.location' },
                    approved_days: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'approved'] }, '$days', 0]
                        }
                    },
                    pending_days: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'pending'] }, '$days', 0]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    employee_id: { $toString: '$_id' },
                    full_name: 1,
                    dni: 1,
                    location: 1,
                    approved_days: 1,
                    pending_days: 1,
                    total_requested_days: { $add: ['$approved_days', '$pending_days'] }
                }
            },
            { $sort: { location: 1, full_name: 1 } }
        ]), 15000);

        res.json({
            range: { start, end },
            location: location || null,
            type,
            rows: rows || []
        });
    } catch (error) {
        console.error('Error en reporte vacation-consumption:', error);
        res.status(500).json({ error: 'Error al generar el reporte' });
    }
});

// GET /api/reports/absences-by-type?start_date=&end_date=&location=
router.get('/absences-by-type', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'reports');
        if (!hasAccess) return;

        const { start, end } = buildRangeFromQuery(req.query);
        const location = (req.query && req.query.location != null) ? String(req.query.location).trim() : '';

        const allowedLocations = await getAllowedLocationsForUser(req);
        const okLoc = ensureLocationAllowed(res, location, allowedLocations);
        if (!okLoc) return;

        const employeeLocationMatch = location
            ? { 'employee.location': location }
            : allowedLocations
                ? { 'employee.location': { $in: allowedLocations } }
                : {};

        const docs = await withMaxTime(Absence.aggregate([
            {
                $match: {
                    start_date: { $lte: end },
                    $or: [
                        { end_date: { $gte: start } },
                        { end_date: { $exists: false } },
                        { end_date: null }
                    ]
                }
            },
            {
                $lookup: {
                    from: 'employees',
                    localField: 'employee_id',
                    foreignField: '_id',
                    as: 'employee'
                }
            },
            { $unwind: '$employee' },
            {
                $match: {
                    'employee.status': { $ne: 'inactive' },
                    ...employeeLocationMatch
                }
            },
            {
                $project: {
                    _id: 0,
                    type: 1,
                    status: 1,
                    start_date: 1,
                    end_date: 1,
                    employee: {
                        _id: { $toString: '$employee._id' },
                        location: '$employee.location'
                    }
                }
            }
        ]), 15000);

        const now = new Date();
        const summary = new Map();

        for (const a of (docs || [])) {
            const key = String(a.type || 'other');
            if (!summary.has(key)) {
                summary.set(key, {
                    type: key,
                    count: 0,
                    total_days: 0,
                    active_count: 0
                });
            }

            const item = summary.get(key);
            item.count += 1;
            if (String(a.status || '').toLowerCase() === 'active') item.active_count += 1;

            const s = new Date(a.start_date);
            const e = a.end_date ? new Date(a.end_date) : now;
            item.total_days += overlapDaysInclusive(s, e, start, end);
        }

        const rows = Array.from(summary.values()).sort((a, b) => a.type.localeCompare(b.type));

        res.json({
            range: { start, end },
            location: location || null,
            rows
        });
    } catch (error) {
        console.error('Error en reporte absences-by-type:', error);
        res.status(500).json({ error: 'Error al generar el reporte' });
    }
});

// GET /api/reports/monthly-location-summary?month=YYYY-MM&location=
router.get('/monthly-location-summary', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'reports');
        if (!hasAccess) return;

        const monthStr = (req.query && req.query.month != null) ? String(req.query.month).trim() : '';
        const m = /^\d{4}-\d{2}$/.test(monthStr) ? monthStr : '';

        const now = new Date();
        const [yy, mm] = m ? m.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];

        const rangeStart = new Date(Date.UTC(yy, mm - 1, 1, 0, 0, 0, 0));
        const rangeEnd = new Date(Date.UTC(yy, mm, 0, 23, 59, 59, 999));

        const location = (req.query && req.query.location != null) ? String(req.query.location).trim() : '';

        const allowedLocations = await getAllowedLocationsForUser(req);
        const okLoc = ensureLocationAllowed(res, location, allowedLocations);
        if (!okLoc) return;

        const employeeQuery = {
            status: { $ne: 'inactive' },
            ...(location
                ? { location }
                : allowedLocations
                    ? { location: { $in: allowedLocations } }
                    : {})
        };

        const employees = await withMaxTime(Employee.find(employeeQuery)
            .select('_id location full_name')
            .lean(), 15000);

        const byEmployeeId = new Map();
        const byLocation = new Map();

        for (const e of (employees || [])) {
            const loc = String(e.location || '').trim() || 'SIN_UBICACION';
            const id = String(e._id);
            byEmployeeId.set(id, loc);

            if (!byLocation.has(loc)) {
                byLocation.set(loc, {
                    location: loc,
                    active_employees: 0,
                    vacation_approved_days: 0,
                    vacation_pending_days: 0,
                    absences_days: 0,
                    absences_active_count: 0
                });
            }
            byLocation.get(loc).active_employees += 1;
        }

        const employeeIds = Array.from(byEmployeeId.keys());

        if (employeeIds.length === 0) {
            res.json({
                range: { start: rangeStart, end: rangeEnd },
                location: location || null,
                rows: []
            });
            return;
        }

        const vacations = await withMaxTime(Vacation.find({
            employee_id: { $in: employeeIds },
            start_date: { $lte: rangeEnd },
            end_date: { $gte: rangeStart },
            status: { $in: ['approved', 'pending'] },
            type: 'vacation'
        })
            .select('employee_id start_date end_date status')
            .lean(), 15000);

        for (const v of (vacations || [])) {
            const empId = String(v.employee_id);
            const loc = byEmployeeId.get(empId);
            if (!loc || !byLocation.has(loc)) continue;

            const overlap = overlapDaysInclusive(new Date(v.start_date), new Date(v.end_date), rangeStart, rangeEnd);
            if (overlap <= 0) continue;

            if (String(v.status).toLowerCase() === 'approved') {
                byLocation.get(loc).vacation_approved_days += overlap;
            } else if (String(v.status).toLowerCase() === 'pending') {
                byLocation.get(loc).vacation_pending_days += overlap;
            }
        }

        const absences = await withMaxTime(Absence.find({
            employee_id: { $in: employeeIds },
            start_date: { $lte: rangeEnd },
            $or: [
                { end_date: { $gte: rangeStart } },
                { end_date: { $exists: false } },
                { end_date: null }
            ]
        })
            .select('employee_id start_date end_date status')
            .lean(), 15000);

        const today = new Date();
        for (const a of (absences || [])) {
            const empId = String(a.employee_id);
            const loc = byEmployeeId.get(empId);
            if (!loc || !byLocation.has(loc)) continue;

            const e = a.end_date ? new Date(a.end_date) : today;
            const overlap = overlapDaysInclusive(new Date(a.start_date), e, rangeStart, rangeEnd);
            if (overlap <= 0) continue;

            byLocation.get(loc).absences_days += overlap;
            if (String(a.status || '').toLowerCase() === 'active') {
                byLocation.get(loc).absences_active_count += 1;
            }
        }

        const rows = Array.from(byLocation.values()).sort((a, b) => a.location.localeCompare(b.location));

        res.json({
            range: { start: rangeStart, end: rangeEnd },
            month: `${yy}-${String(mm).padStart(2, '0')}`,
            location: location || null,
            rows
        });
    } catch (error) {
        console.error('Error en reporte monthly-location-summary:', error);
        res.status(500).json({ error: 'Error al generar el reporte' });
    }
});

module.exports = router;
