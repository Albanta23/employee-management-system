const mongoose = require('mongoose');

const SchedulePublicationSchema = new mongoose.Schema({
    shift_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
    month:    { type: Number, required: true },   // 0–11
    year:     { type: Number, required: true },

    sent_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sent_at:  { type: Date, default: Date.now },

    employees_notified: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
    total_notified:     { type: Number, default: 0 },

    // Snapshot del horario en el momento de la publicación (para auditoría)
    schedule_snapshot: { type: mongoose.Schema.Types.Mixed }
});

SchedulePublicationSchema.index({ shift_id: 1, year: 1, month: 1 });

module.exports = mongoose.model('SchedulePublication', SchedulePublicationSchema);
