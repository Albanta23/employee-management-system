const mongoose = require('mongoose');

/**
 * Plan de rotación semanal para empleados rotativos.
 * Cuando un empleado (can_rotate=true) cubre un turno diferente al suyo principal
 * durante una semana concreta, se registra aquí.
 *
 * Ejemplo: Empleado de mañana que cubre el turno de tarde la semana del 10-16 de febrero.
 */
const ShiftRotationPlanSchema = new mongoose.Schema({
    employee_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    from_shift_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true }, // turno origen (mañana)
    to_shift_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true }, // turno que cubre esa semana (tarde)
    week_start:    { type: Date, required: true }, // Lunes de la semana (UTC midnight)
    week_end:      { type: Date, required: true }, // Domingo de la semana (UTC 23:59)
    notes:         { type: String, default: '' },
    created_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ShiftRotationPlanSchema.index({ employee_id: 1, week_start: 1 });
ShiftRotationPlanSchema.index({ to_shift_id: 1, week_start: 1 });
ShiftRotationPlanSchema.index({ from_shift_id: 1, week_start: 1 });

module.exports = mongoose.model('ShiftRotationPlan', ShiftRotationPlanSchema);
