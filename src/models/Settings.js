const mongoose = require('mongoose');

const overlapRulesSchema = new mongoose.Schema({
    // Matriz de bloqueo por categoría (vacation/permission/absence)
    vacation: {
        vacation: { type: Boolean, default: true },
        permission: { type: Boolean, default: true },
        absence: { type: Boolean, default: true }
    },
    permission: {
        vacation: { type: Boolean, default: true },
        permission: { type: Boolean, default: true },
        absence: { type: Boolean, default: true }
    },
    absence: {
        vacation: { type: Boolean, default: true },
        permission: { type: Boolean, default: true },
        absence: { type: Boolean, default: true }
    }
}, { _id: false });

const vacationPolicySchema = new mongoose.Schema({
    proration_enabled: { type: Boolean, default: false },
    // Incremento para redondeo del prorrateo (0.5 = medios días)
    proration_rounding_increment: { type: Number, default: 0.5 },

    carryover_enabled: { type: Boolean, default: false },
    // Máximo de días que se pueden arrastrar del año anterior
    carryover_max_days: { type: Number, default: 0 },
    // Fecha de caducidad dentro del año actual en formato MM-DD (p.ej. 03-31)
    carryover_expiry_month_day: { type: String, default: '03-31' }
}, { _id: false });

const settingsSchema = new mongoose.Schema({
    company_name: {
        type: String,
        default: 'Mi Empresa'
    },
    company_address: {
        type: String,
        default: ''
    },
    company_cif: {
        type: String,
        default: ''
    },
    logo_base64: {
        type: String, // Store as base64 data URI for simplicity
        default: ''
    },

    // --- Coordinador de Tiendas ---
    // Lista de ubicaciones que se consideran "tiendas".
    // El coordinador solo podrá ver/gestionar empleados cuya `location` esté en esta lista.
    store_locations: {
        type: [String],
        default: []
    },
    store_coordinator_enabled: {
        type: Boolean,
        default: false
    },
    // Referencia al usuario coordinador (cuenta única gestionada por el admin desde Configuración)
    store_coordinator_user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // Permisos por secciones (UI + API). Admin siempre tiene acceso completo.
    store_coordinator_access: {
        dashboard: { type: Boolean, default: true },
        employees: { type: Boolean, default: true },
        attendance: { type: Boolean, default: true },
        quadrants: { type: Boolean, default: true },
        vacations: { type: Boolean, default: true },
        absences: { type: Boolean, default: true },
        permissions: { type: Boolean, default: true },
        reports: { type: Boolean, default: true },
        locations: { type: Boolean, default: true },
        // Permite acceder a Configuración (solo a lo que exponga la UI).
        settings: { type: Boolean, default: false }
    },

    // Reglas configurables para permitir/bloquear solapes
    overlap_rules: {
        type: overlapRulesSchema,
        default: () => ({})
    },

    // Overrides por tienda/ubicación (clave = Employee.location)
    overlap_rules_by_location: {
        type: Map,
        of: overlapRulesSchema,
        default: () => ({})
    },

    // Política de saldo anual de vacaciones (prorrateo + carryover)
    vacation_policy: {
        type: vacationPolicySchema,
        default: () => ({})
    },

    updated_at: {
        type: Date,
        default: Date.now
    }
});

// We only need one settings document
module.exports = mongoose.model('Settings', settingsSchema);
