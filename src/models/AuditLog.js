const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    created_at: { type: Date, default: Date.now, index: true },

    actor: {
        user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        username: { type: String, default: '' },
        role: { type: String, default: '' }
    },

    action: { type: String, required: true, index: true },

    entity: {
        type: { type: String, required: true, index: true },
        id: { type: String, default: '', index: true }
    },

    employee: {
        id: { type: String, default: '', index: true },
        location: { type: String, default: '', index: true }
    },

    // Snapshot/diff simple: valores antes/después (solo campos relevantes)
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    meta: { type: mongoose.Schema.Types.Mixed, default: null }
}, { versionKey: false });

auditLogSchema.index({ 'employee.id': 1, created_at: -1 });
auditLogSchema.index({ 'entity.type': 1, created_at: -1 });
auditLogSchema.index({ action: 1, created_at: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
