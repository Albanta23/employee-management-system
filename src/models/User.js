const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String },
    role: { type: String, enum: ['admin', 'employee', 'store_coordinator'], default: 'admin' },
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    mustChangePassword: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);