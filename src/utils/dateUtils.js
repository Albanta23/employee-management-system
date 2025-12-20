const Holiday = require('../models/Holiday');

/**
 * Calcula los días reales de vacaciones a descontar entre dos fechas.
 * Según la petición del usuario: 30 días naturales sin contar fines de semana ni festivos.
 * @param {Date} startDate 
 * @param {Date} endDate 
 * @param {String} location Ubicación para festivos locales
 */
async function calculateVacationDays(startDate, endDate, location) {
    let count = 0;
    let current = new Date(startDate);
    const end = new Date(endDate);

    // Obtener todos los festivos en el rango para esta ubicación (o nacionales)
    const holidays = await Holiday.find({
        date: { $gte: startDate, $lte: endDate }
    }).lean();

    const holidayStrings = holidays.filter(h => {
        // Incluir si es nacional o si es local y coincide con la ubicación
        return h.type === 'national' || (h.type === 'local' && h.location === location);
    }).map(h => h.date.toISOString().split('T')[0]);

    while (current <= end) {
        const dayOfWeek = current.getDay(); // 0 = Domingo, 6 = Sábado
        const dateStr = current.toISOString().split('T')[0];

        // Si no es fin de semana (Sábado/Domingo) y no es festivo
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayStrings.includes(dateStr)) {
            count++;
        }

        current.setDate(current.getDate() + 1);
    }

    return count;
}

module.exports = {
    calculateVacationDays
};
