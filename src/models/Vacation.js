const mongoose = require('mongoose');

const VacationSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    days: { type: Number, required: true },
    type: { type: String, enum: ['vacation', 'personal', 'compensatory'], default: 'vacation' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reason: { type: String },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approved_date: { type: Date }
}, { timestamps: true });

VacationSchema.index({ employee_id: 1, start_date: 1, end_date: 1 });
VacationSchema.index({ employee_id: 1, status: 1, type: 1 });
VacationSchema.index({ status: 1, type: 1 });

module.exports = mongoose.model('Vacation', VacationSchema);
