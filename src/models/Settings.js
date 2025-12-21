const mongoose = require('mongoose');

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
        vacations: { type: Boolean, default: true },
        absences: { type: Boolean, default: true },
        permissions: { type: Boolean, default: true },
        reports: { type: Boolean, default: true },
        locations: { type: Boolean, default: true }
    },

    updated_at: {
        type: Date,
        default: Date.now
    }
});

// We only need one settings document
module.exports = mongoose.model('Settings', settingsSchema);
