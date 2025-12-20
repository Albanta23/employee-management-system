const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    type: { type: String, required: true, enum: ['in', 'out', 'break_start', 'break_end'] },
    timestamp: { type: Date, default: Date.now },
    latitude: { type: Number },
    longitude: { type: Number },
    device_info: { type: String },
    notes: { type: String },
    ip_address: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
