const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, isAdmin, getStoreLocations } = require('../utils/accessScope');
const { logAudit, pick, shallowDiff } = require('../utils/audit');

const Quadrant = require('../models/Quadrant');
const Employee = require('../models/Employee');
const Location = require('../models/Location');

function normalizeForCompare(value) {
    const s = (value == null ? '' : String(value)).trim();
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isFactoryName(value) {
    const normalized = normalizeForCompare(value);
    if (!normalized) return false;
    return normalized.includes('fabrica') || normalized.includes('factory');
}

function parseMonth(value) {
    const s = (value == null ? '' : String(value)).trim();
    if (!/^\d{4}-\d{2}$/.test(s)) return null;
    const [y, m] = s.split('-').map(n => Number(n));
    if (!Number.isFinite(y) || !Number.isFinite(m) || y < 1970 || y > 3000 || m < 1 || m > 12) return null;
    return s;
}

function normalizeLocation(value) {
    return (value == null ? '' : String(value)).trim();
}

async function ensureStoreAllowed(req, res, storeName) {
    if (isAdmin(req.user)) return true;
    const allowed = await getStoreLocations();
    if (!allowed.includes(String(storeName))) {
        res.status(403).json({ error: 'Acceso denegado a esta tienda' });
        return false;
    }
    return true;
}

async function ensureStoreIsValid(req, res, storeName) {
    if (!storeName) {
        res.status(400).json({ error: 'Tienda inválida' });
        return false;
    }

    if (!isAdmin(req.user) && isFactoryName(storeName)) {
        res.status(400).json({ error: 'Solo se permiten tiendas (no fábrica)' });
        return false;
    }

    // Validar existencia real en Locations.stores
    const exists = await Location.findOne({
        active: true,
        'stores.name': String(storeName)
    })
        .select('_id')
        .lean()
        .maxTimeMS(15000);

    if (!exists) {
        res.status(404).json({ error: 'Tienda no encontrada' });
        return false;
    }

    return true;
}

function sanitizeCode(value) {
    const s = (value == null ? '' : String(value));
    const trimmed = s.trim();
    if (!trimmed) return '';
    // Código corto editable (evita PDFs gigantes / abuso)
    return trimmed.slice(0, 16);
}

router.use(authenticateToken);

// GET /api/quadrants/stores
// Devuelve la lista de tiendas permitidas para el usuario actual.
router.get('/stores', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'quadrants');
        if (!hasAccess) return;

        if (isAdmin(req.user)) {
            const locations = await Location.find({ active: true })
                .select('stores.name')
                .lean()
                .maxTimeMS(15000);

            const names = [];
            for (const loc of (locations || [])) {
                for (const st of (loc.stores || [])) {
                    const n = (st && st.name) ? String(st.name).trim() : '';
                    if (!n) continue;
                    names.push(n);
                }
            }

            return res.json({ stores: Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'es')) });
        }

        const stores = await getStoreLocations();
        const filtered = (stores || []).filter(s => s && !isFactoryName(s));
        return res.json({ stores: Array.from(new Set(filtered)).sort((a, b) => a.localeCompare(b, 'es')) });
    } catch (error) {
        console.error('Error al obtener tiendas para cuadrantes:', error);
        res.status(500).json({ error: 'Error al obtener tiendas' });
    }
});

// GET /api/quadrants?location=TIENDA&month=YYYY-MM
router.get('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'quadrants');
        if (!hasAccess) return;

        const location = normalizeLocation(req.query && req.query.location);
        const month = parseMonth(req.query && req.query.month);

        if (!location) return res.status(400).json({ error: 'location es requerido' });
        if (!month) return res.status(400).json({ error: 'month inválido (YYYY-MM)' });

        const ok = await ensureStoreAllowed(req, res, location);
        if (!ok) return;

        const okStore = await ensureStoreIsValid(req, res, location);
        if (!okStore) return;

        const employees = await Employee.find({
            location,
            status: { $ne: 'inactive' }
        })
            .select('_id full_name dni position status location')
            .sort({ full_name: 1 })
            .lean()
            .maxTimeMS(15000);

        const doc = await Quadrant.findOne({ location, month }).lean().maxTimeMS(15000);

        const assignments = {};
        for (const item of (doc && doc.employees ? doc.employees : [])) {
            const empId = item && item.employee_id ? String(item.employee_id) : '';
            if (!empId) continue;
            const daysObj = {};
            if (item.days && typeof item.days === 'object') {
                // Map puede venir como objeto en lean()
                for (const [k, v] of Object.entries(item.days)) {
                    const code = sanitizeCode(v);
                    if (code) daysObj[String(k)] = code;
                }
            }
            assignments[empId] = daysObj;
        }

        res.json({
            location,
            month,
            employees: (employees || []).map(e => ({
                id: String(e._id),
                _id: String(e._id),
                full_name: e.full_name,
                dni: e.dni,
                position: e.position,
                status: e.status,
                location: e.location
            })),
            assignments
        });
    } catch (error) {
        console.error('Error al obtener cuadrante:', error);
        res.status(500).json({ error: 'Error al obtener cuadrante' });
    }
});

// PUT /api/quadrants?location=TIENDA&month=YYYY-MM
// body: { assignments: { [employeeId]: { [YYYY-MM-DD]: "M" } } }
router.put('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'quadrants');
        if (!hasAccess) return;

        const location = normalizeLocation(req.query && req.query.location);
        const month = parseMonth(req.query && req.query.month);

        if (!location) return res.status(400).json({ error: 'location es requerido' });
        if (!month) return res.status(400).json({ error: 'month inválido (YYYY-MM)' });

        const ok = await ensureStoreAllowed(req, res, location);
        if (!ok) return;

        const okStore = await ensureStoreIsValid(req, res, location);
        if (!okStore) return;

        const assignments = (req.body && req.body.assignments && typeof req.body.assignments === 'object')
            ? req.body.assignments
            : null;

        if (!assignments) {
            return res.status(400).json({ error: 'assignments es requerido' });
        }

        const employeeIds = Object.keys(assignments);
        if (employeeIds.length > 800) {
            return res.status(400).json({ error: 'Demasiados empleados en el cuadrante' });
        }

        // Validar que los empleados pertenecen a la tienda y no están inactivos
        const employees = await Employee.find({
            _id: { $in: employeeIds },
            location,
            status: { $ne: 'inactive' }
        })
            .select('_id')
            .lean()
            .maxTimeMS(15000);

        const allowedEmployeeIdSet = new Set((employees || []).map(e => String(e._id)));

        const employeesPayload = [];
        for (const empId of employeeIds) {
            if (!allowedEmployeeIdSet.has(String(empId))) continue;

            const daysRaw = assignments[empId] && typeof assignments[empId] === 'object' ? assignments[empId] : {};
            const daysClean = {};

            for (const [dateKey, rawCode] of Object.entries(daysRaw)) {
                const date = String(dateKey || '').trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                if (!date.startsWith(month + '-')) continue;

                const code = sanitizeCode(rawCode);
                if (code) daysClean[date] = code;
            }

            employeesPayload.push({ employee_id: empId, days: daysClean });
        }

        const beforeDoc = await Quadrant.findOne({ location, month }).lean().maxTimeMS(15000);

        const updated = await Quadrant.findOneAndUpdate(
            { location, month },
            { $set: { employees: employeesPayload } },
            { new: true, upsert: true }
        ).lean();

        try {
            const before = pick(beforeDoc || {}, ['_id', 'location', 'month', 'employees']);
            const after = pick(updated || {}, ['_id', 'location', 'month', 'employees']);
            const diff = shallowDiff(before, after);
            await logAudit({
                actor: req.user,
                action: 'quadrant.upsert',
                entity: 'quadrant',
                entity_id: updated && updated._id ? String(updated._id) : undefined,
                details: {
                    location,
                    month,
                    employee_count: employeesPayload.length,
                    changes: diff
                }
            });
        } catch (e) {
            console.warn('No se pudo auditar quadrant.upsert:', e && e.message ? e.message : e);
        }

        res.json({ ok: true });
    } catch (error) {
        console.error('Error al guardar cuadrante:', error);
        res.status(500).json({ error: 'Error al guardar cuadrante' });
    }
});

module.exports = router;
