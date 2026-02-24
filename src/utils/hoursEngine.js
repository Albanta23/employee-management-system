/**
 * hoursEngine.js
 * Motor de cálculo de horas para el sistema de turnos.
 * Módulo puro (sin efectos secundarios, sin acceso a BD).
 * Se puede importar en el backend y copiar/usar en el frontend sin cambios.
 */

/**
 * Convierte una cadena "HH:mm" a minutos desde medianoche.
 */
function timeToMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

/**
 * Devuelve los días del mes (números 1–31) que son sábado.
 * @param {number} year
 * @param {number} month  0–11
 */
function getSaturdays(year, month) {
    const sats = [];
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
        if (new Date(year, month, d).getDay() === 6) sats.push(d);
    }
    return sats;
}

/**
 * Calcula horas programadas, objetivo y balance para un turno en un mes concreto.
 *
 * @param {Object} shift             - Documento Shift (o POJO equivalente)
 * @param {number} year
 * @param {number} month             - 0–11
 * @param {number} absenceDaysOverride - días de ausencia a descontar (simulador, opcional)
 * @returns {Object}
 *   targetMins       - minutos objetivo (proporcional a semanas del mes)
 *   scheduledMins    - minutos programados reales
 *   balanceMins      - scheduledMins - targetMins (negativo = pocos, positivo = muchos)
 *   effectiveMins    - scheduledMins - ausencias
 *   weekdayCount     - días laborables entre semana (L–V)
 *   satWorked        - sábados trabajados
 *   satOff           - sábados libres del turno
 *   weekdayMins      - minutos por día entre semana
 *   satMins          - minutos por sábado trabajado
 *   satWorkDays      - array de días del mes que son sábados trabajados
 *   satOffDays       - array de días del mes que son sábados libres
 *   absMins          - minutos de ausencia descontados
 */
function calcShiftHours(shift, year, month, absenceDaysOverride = 0) {
    const lastDay  = new Date(year, month + 1, 0).getDate();
    const sats     = getSaturdays(year, month);
    const openDays = shift.openDays || [1, 2, 3, 4, 5];

    // Sábados en que este turno descansa según satWeeksOff
    const satOff  = (shift.satWeeksOff || []).map(i => sats[i]).filter(Boolean);
    const satWork = sats.filter(s => !satOff.includes(s) && openDays.includes(6));

    // Contar días laborables entre semana (L–V) según openDays
    let weekdayCount = 0;
    for (let d = 1; d <= lastDay; d++) {
        const dow = new Date(year, month, d).getDay();
        if (dow !== 0 && dow !== 6 && openDays.includes(dow)) weekdayCount++;
    }

    const weekdayMins = timeToMins(shift.weekdayEnd) - timeToMins(shift.weekdayStart);
    const satMins     = openDays.includes(6) && shift.satStart && shift.satEnd
        ? timeToMins(shift.satEnd) - timeToMins(shift.satStart)
        : 0;

    const scheduledMins = weekdayCount * weekdayMins + satWork.length * satMins;

    // Objetivo proporcional: semanas-equivalente × horas objetivo por semana
    const weeksInMonth = weekdayCount / 5;
    const targetMins   = Math.round((shift.targetHoursWeek || 40) * 60 * weeksInMonth);
    const balanceMins  = scheduledMins - targetMins;

    const absMins      = absenceDaysOverride * weekdayMins;
    const effectiveMins = scheduledMins - absMins;

    return {
        targetMins,
        scheduledMins,
        balanceMins,
        effectiveMins,
        weekdayCount,
        satWorked:   satWork.length,
        satOff:      satOff.length,
        weekdayMins,
        satMins,
        satWorkDays: satWork,
        satOffDays:  satOff,
        absMins,
    };
}

/**
 * Sugiere un ajuste del horario de salida para cuadrar exactamente el objetivo mensual.
 * Devuelve null si el balance ya está dentro de ±5 minutos.
 *
 * @param {Object} shift
 * @param {number} year
 * @param {number} month  0–11
 * @returns {Object|null}
 */
function suggestAdjustment(shift, year, month) {
    const h = calcShiftHours(shift, year, month);
    if (Math.abs(h.balanceMins) < 5) return null;

    const totalDays = h.weekdayCount + h.satWorked;
    if (totalDays === 0) return null;

    const minsPerDay   = h.balanceMins / totalDays;
    const newEndMins   = timeToMins(shift.weekdayEnd) - minsPerDay;
    const hh = String(Math.floor(newEndMins / 60)).padStart(2, '0');
    const mm = String(Math.round(newEndMins % 60)).padStart(2, '0');

    return {
        balanceMins:         h.balanceMins,
        minsPerDay:          Math.round(minsPerDay),
        suggestedWeekdayEnd: `${hh}:${mm}`,
        originalHours:       (h.scheduledMins / 60).toFixed(1),
        targetHours:         (h.targetMins / 60).toFixed(1),
    };
}

/**
 * Genera el array de días del mes con su estado para el calendario visual.
 * Cada entrada indica si el día es laborable, sábado libre, sábado trabajado, domingo, etc.
 *
 * @param {Object} shift
 * @param {number} year
 * @param {number} month  0–11
 * @returns {Array<Object>}
 */
function buildCalendarDays(shift, year, month) {
    const h       = calcShiftHours(shift, year, month);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const days    = [];

    for (let d = 1; d <= lastDay; d++) {
        const date = new Date(year, month, d);
        const dow  = date.getDay();
        let type, startTime, endTime;

        if (dow === 0) {
            // Domingo: siempre libre
            type = 'sunday';
        } else if (dow === 6) {
            if (h.satOffDays.includes(d)) {
                type = 'sat_off';
            } else if (h.satWorkDays.includes(d)) {
                type = 'sat_work';
                startTime = shift.satStart;
                endTime   = shift.satEnd;
            } else {
                type = 'saturday_closed'; // Turno no trabaja sábados
            }
        } else {
            // L–V
            if ((shift.openDays || [1,2,3,4,5]).includes(dow)) {
                type      = 'workday';
                startTime = shift.weekdayStart;
                endTime   = shift.weekdayEnd;
            } else {
                type = 'closed';
            }
        }

        days.push({ day: d, dow, type, startTime: startTime || null, endTime: endTime || null });
    }

    return days;
}

module.exports = { calcShiftHours, suggestAdjustment, getSaturdays, timeToMins, buildCalendarDays };
