const mongoose = require('mongoose');

const VacationSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    // Año contable al que imputan los días (p.ej. "vacaciones de 2025" disfrutadas en 2026).
    // Si no se informa, se puede derivar de start_date o del texto del motivo.
    vacation_year: { type: Number },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    days: { type: Number, required: true },
    // Desglose FIFO del consumo: primero carryover (años anteriores), luego año vigente.
    // Nota: el campo `days` mantiene el total de la solicitud.
    allocation: {
        carryover_days: { type: Number, default: 0 },
        current_year_days: { type: Number, default: 0 }
    },
    type: { type: String, enum: ['vacation', 'personal', 'compensatory'], default: 'vacation' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled', 'revoked'], default: 'pending' },
    // Motivo/nota indicada al solicitar (empleado o admin)
    reason: { type: String },

    // Trazabilidad de decisión
    rejection_reason: { type: String },
    rejected_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejected_date: { type: Date },

    cancellation_reason: { type: String },
    cancelled_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelled_date: { type: Date },

    revocation_reason: { type: String },
    revoked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revoked_date: { type: Date },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approved_date: { type: Date }
}, { timestamps: true });

VacationSchema.index({ employee_id: 1, start_date: 1, end_date: 1 });
VacationSchema.index({ employee_id: 1, vacation_year: 1, type: 1, status: 1 });
VacationSchema.index({ employee_id: 1, status: 1, type: 1 });
VacationSchema.index({ status: 1, type: 1 });

module.exports = mongoose.model('Vacation', VacationSchema);
