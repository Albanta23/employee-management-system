const mongoose = require('mongoose');

const ShiftSchema = new mongoose.Schema({
    name:        { type: String, required: true },       // "Turno A"
    color:       { type: String, default: '#00C6A2' },   // color hex

    location_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
    store_name:  { type: String, required: true },         // tienda a la que pertenece el turno

    // Horario entre semana (Lunes–Viernes)
    weekdayStart: { type: String, required: true },      // "08:00"
    weekdayEnd:   { type: String, required: true },      // "16:00"

    // Horario sábado (solo si openDays incluye 6)
    satStart: { type: String, default: '' },             // "08:00"
    satEnd:   { type: String, default: '' },             // "15:00"

    // Índices (0-based) de los sábados del mes que son libres para este turno
    // Ej: [0, 2] → 1er y 3er sábado del mes libres
    satWeeksOff: { type: [Number], default: [] },

    // Días en que se trabaja (0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb)
    openDays: { type: [Number], default: [1, 2, 3, 4, 5] },

    targetHoursWeek: { type: Number, default: 40 },     // objetivo h/semana por trabajador
    workersPerShift:  { type: Number, default: 1 },     // nº trabajadores en este turno
    min_workers:      { type: Number, default: 1 },     // mínimo de trabajadores para considerar el turno cubierto

    active: { type: Boolean, default: true },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ShiftSchema.index({ store_name: 1, active: 1 });

module.exports = mongoose.model('Shift', ShiftSchema);
