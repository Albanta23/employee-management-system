const mongoose = require('mongoose');

const InAppNotificationSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

    type: {
        type: String,
        enum: [
            'schedule_published',   // Horario mensual publicado
            'shift_changed',        // Cambio en la configuración del turno
            'shift_assigned',       // Empleado asignado a un turno
            'shift_unassigned',     // Empleado desasignado de un turno
            'absence_impact',       // Impacto de ausencia en cobertura
            // Tipos genéricos para otras partes del sistema
            'vacation_approved',
            'vacation_rejected',
            'vacation_cancelled',
            'permission_approved',
            'permission_rejected',
        ],
        required: true
    },

    title:   { type: String, required: true },
    body:    { type: String, required: true },
    read:    { type: Boolean, default: false },
    read_at: { type: Date,   default: null },

    // Datos opcionales para que el frontend pueda navegar al recurso correcto
    data: {
        shift_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
        vacation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Vacation' },
        month:       { type: Number },   // 0–11
        year:        { type: Number },
    },

    created_at: { type: Date, default: Date.now }
});

InAppNotificationSchema.index({ employee_id: 1, read: 1, created_at: -1 });

module.exports = mongoose.model('InAppNotification', InAppNotificationSchema);
