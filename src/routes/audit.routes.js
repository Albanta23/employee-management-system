const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { ensureEmployeeInScope, isStoreCoordinator, getStoreEmployeeIds, getSettingsForAccess, getStoreLocations, isAdmin } = require('../utils/accessScope');
const AuditLog = require('../models/AuditLog');

router.use(authenticateToken);

function parseLimit(value, def = 200, max = 500) {
    const n = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(max, n);
}

async function ensureAuditAccess(req, res) {
    if (isAdmin(req.user)) return true;

    if (!isStoreCoordinator(req.user)) {
        res.status(403).json({ error: 'Acceso denegado' });
        return false;
    }

    const settings = await getSettingsForAccess();
    if (!settings.store_coordinator_enabled) {
        res.status(403).json({ error: 'Perfil de Coordinador desactivado' });
        return false;
    }

    const access = settings.store_coordinator_access || {};
    if (!access.reports && !access.employees) {
        res.status(403).json({ error: 'Acceso denegado para esta sección' });
        return false;
    }

    const storeLocations = await getStoreLocations();
    if (storeLocations.length === 0) {
        res.status(403).json({ error: 'No hay ubicaciones de tienda disponibles (todas parecen ser fábrica o están vacías)' });
        return false;
    }

    return true;
}

// GET /api/audit?employee_id=&entity_type=&entity_id=&action=&limit=
router.get('/', async (req, res) => {
    try {
        // Permite usar auditoría también desde la ficha del empleado (no solo Reports)
        const hasAccess = await ensureAuditAccess(req, res);
        if (!hasAccess) return;

        const { employee_id, entity_type, entity_id, action } = req.query || {};
        const limit = parseLimit(req.query && req.query.limit);

        const query = {};

        if (action) query.action = String(action);
        if (entity_type) query['entity.type'] = String(entity_type);
        if (entity_id) query['entity.id'] = String(entity_id);

        if (employee_id) {
            const ok = await ensureEmployeeInScope(req, res, employee_id);
            if (!ok) return;
            query['employee.id'] = String(employee_id);
        } else if (isStoreCoordinator(req.user)) {
            // Para coordinador: limitar a empleados en scope.
            const ids = await getStoreEmployeeIds();
            query['employee.id'] = { $in: (ids || []).map(String) };
        }

        const logs = await AuditLog.find(query)
            .sort({ created_at: -1 })
            .limit(limit)
            .lean();

        res.json({ logs });
    } catch (error) {
        console.error('Error al obtener auditoría:', error);
        res.status(500).json({ error: 'Error al obtener auditoría' });
    }
});

module.exports = router;
