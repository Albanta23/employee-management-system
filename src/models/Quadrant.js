const mongoose = require('mongoose');

const QuadrantEmployeeSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    // Mapa YYYY-MM-DD -> código libre (ej: M, T, N, L, etc.)
    days: {
        type: Map,
        of: String,
        default: () => ({})
    }
}, { _id: false });

const QuadrantSchema = new mongoose.Schema({
    // Tienda (coincide con Employee.location)
    location: { type: String, required: true },
    // Mes en formato YYYY-MM
    month: { type: String, required: true },
    employees: {
        type: [QuadrantEmployeeSchema],
        default: []
    }
}, { timestamps: true });

QuadrantSchema.index({ location: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Quadrant', QuadrantSchema);
