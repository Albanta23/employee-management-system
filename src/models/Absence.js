const mongoose = require('mongoose');

const AbsenceSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date },
    type: { type: String, required: true, enum: ['medical', 'maternity', 'paternity', 'accident', 'other'] },
    reason: { type: String },
    medical_certificate: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
    notes: { type: String },

    // Ausencia por no presentarse que descuenta días de vacaciones (según justificación).
    // Se usa únicamente para type='other'. Para bajas médicas u otros tipos debe ser false.
    deduct_from_vacation: { type: Boolean, default: false },
    // Si se informa, fuerza los días a descontar (p.ej. 1). Si no, se calcula por rango (días naturales inclusivos).
    deduct_vacation_days: { type: Number }
}, { timestamps: true });

AbsenceSchema.index({ employee_id: 1, status: 1, start_date: 1 });
AbsenceSchema.index({ status: 1, start_date: 1 });

module.exports = mongoose.model('Absence', AbsenceSchema);
