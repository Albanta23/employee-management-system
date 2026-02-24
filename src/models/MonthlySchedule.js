const mongoose = require('mongoose');

/**
 * Cuadrícula mensual de turnos para una tienda.
 * Almacena la asignación manual M/T/L por empleado y día.
 * Las ausencias (V=vacación, B=baja) se superponen dinámicamente
 * leyendo Vacation y Absence en tiempo real.
 */
const AssignmentSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    day:         { type: Number, required: true, min: 1, max: 31 }, // día del mes
    slot:        { type: String, enum: ['M', 'T', 'L'], required: true } // M=mañana, T=tarde, L=libre
}, { _id: false });

const MonthlyScheduleSchema = new mongoose.Schema({
    store_name:         { type: String, required: true },
    year:               { type: Number, required: true },
    month:              { type: Number, required: true, min: 0, max: 11 }, // 0-based (Jan=0)
    min_morning:        { type: Number, default: 5 },   // aviso si hay menos mañanas ese día
    min_afternoon:      { type: Number, default: 3 },   // aviso si hay menos tardes ese día
    assignments:        { type: [AssignmentSchema], default: [] },
    closed_afternoons:  { type: [Number], default: [] }, // días del mes con tarde cerrada
    published:          { type: Boolean, default: false },
    created_by:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Índice único: solo puede haber una cuadrícula por tienda+mes+año
MonthlyScheduleSchema.index({ store_name: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('MonthlySchedule', MonthlyScheduleSchema);
