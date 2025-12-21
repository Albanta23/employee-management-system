const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema({
    full_name: { type: String, required: true },
    dni: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    email: { type: String },
    position: { type: String, required: true },
    location: { type: String, required: true },
    convention: { type: String },
    annual_vacation_days: { type: Number, default: 30 },
    status: { type: String, enum: ['active', 'inactive', 'on_leave'], default: 'active' },
    hire_date: { type: Date },
    termination_date: { type: Date },
    salary: { type: Number },
    notes: { type: String }
}, { timestamps: true });

EmployeeSchema.index({ status: 1, location: 1 });
EmployeeSchema.index({ location: 1 });

module.exports = mongoose.model('Employee', EmployeeSchema);
