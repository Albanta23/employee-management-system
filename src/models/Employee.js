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
    notes: { type: String },

    // Horario de trabajo configurado por el empleado (portal empleado)
    // Se usa para validar si los fichajes se están realizando correctamente.
    work_schedule: {
        enabled: { type: Boolean, default: false },
        // 0=Domingo ... 6=Sábado (Date#getDay)
        days_of_week: { type: [Number], default: [1, 2, 3, 4, 5] },
        // Formato HH:mm
        start_time: { type: String, default: '09:00' },
        end_time: { type: String, default: '18:00' },
        // Descanso opcional (si se usan, deben venir ambos)
        break_start: { type: String, default: '' },
        break_end: { type: String, default: '' },
        tolerance_minutes: { type: Number, default: 10 }
    }
}, { timestamps: true });

EmployeeSchema.index({ status: 1, location: 1 });
EmployeeSchema.index({ location: 1 });

module.exports = mongoose.model('Employee', EmployeeSchema);
