const AuditLog = require('../models/AuditLog');

function safeString(value) {
    if (value == null) return '';
    return String(value);
}

async function logAudit({
    req,
    action,
    entityType,
    entityId,
    employeeId,
    employeeLocation,
    before = null,
    after = null,
    meta = null
}) {
    try {
        const user = req && req.user ? req.user : null;

        const doc = {
            actor: {
                user_id: user && user.id ? user.id : null,
                username: safeString(user && user.username ? user.username : ''),
                role: safeString(user && user.role ? user.role : '')
            },
            action: safeString(action),
            entity: {
                type: safeString(entityType),
                id: safeString(entityId)
            },
            employee: {
                id: safeString(employeeId),
                location: safeString(employeeLocation)
            },
            before,
            after,
            meta
        };

        // Nunca bloquear la operación principal por auditoría.
        await AuditLog.create(doc);
    } catch (err) {
        // Silencioso a propósito (solo log de servidor)
        console.warn('⚠️ AuditLog error:', err && err.message ? err.message : err);
    }
}

function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    }
    return out;
}

function shallowDiff(before, after) {
    const out = {};
    const b = before || {};
    const a = after || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const k of keys) {
        const bv = b[k];
        const av = a[k];
        if (JSON.stringify(bv) !== JSON.stringify(av)) {
            out[k] = { before: bv, after: av };
        }
    }
    return out;
}

module.exports = {
    logAudit,
    pick,
    shallowDiff
};
