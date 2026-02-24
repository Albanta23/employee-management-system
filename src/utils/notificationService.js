/**
 * notificationService.js
 * Servicio de notificaciones in-app para el portal del empleado.
 * Cubre turnos y también las aprobaciones/rechazos de vacaciones y permisos,
 * de forma que el empleado tenga una bandeja unificada en su dashboard.
 */

const InAppNotification = require('../models/InAppNotification');

/**
 * Crea una notificación in-app para un empleado.
 */
async function createInAppNotification(employeeId, type, title, body, data = {}) {
    return InAppNotification.create({ employee_id: employeeId, type, title, body, data });
}

// ─── Turnos ───────────────────────────────────────────────────────────────────

const MONTHS_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Notifica a todos los empleados de un turno que se ha publicado el horario del mes.
 * @param {Array}  employees  - array de documentos Employee
 * @param {Object} shift      - documento Shift
 * @param {number} month      - 0–11
 * @param {number} year
 */
async function notifyShiftPublished(employees, shift, month, year) {
    const monthLabel = `${MONTHS_ES[month]} ${year}`;
    const promises = employees.map(emp =>
        createInAppNotification(
            emp._id,
            'schedule_published',
            `Horario de ${monthLabel} publicado`,
            `Tu horario para ${monthLabel} ya está disponible. Turno: ${shift.name} (${shift.weekdayStart}–${shift.weekdayEnd}).`,
            { shift_id: shift._id, month, year }
        )
    );
    return Promise.all(promises);
}

/**
 * Notifica a un empleado que ha sido asignado a un turno.
 */
async function notifyShiftAssigned(employee, shift) {
    return createInAppNotification(
        employee._id,
        'shift_assigned',
        `Asignado a ${shift.name}`,
        `Has sido asignado al ${shift.name}. Horario: ${shift.weekdayStart}–${shift.weekdayEnd} (L–V).`,
        { shift_id: shift._id }
    );
}

/**
 * Notifica a un empleado que ha sido desasignado de su turno.
 */
async function notifyShiftUnassigned(employee, shiftName) {
    return createInAppNotification(
        employee._id,
        'shift_unassigned',
        'Turno desasignado',
        `Has sido desasignado del turno ${shiftName}. Contacta con tu coordinador para más información.`,
        {}
    );
}

/**
 * Notifica a un empleado que el turno al que pertenece ha sido modificado.
 */
async function notifyShiftChanged(employee, shift) {
    return createInAppNotification(
        employee._id,
        'shift_changed',
        `Cambio en ${shift.name}`,
        `La configuración de tu turno (${shift.name}) ha sido actualizada. Revisa tu horario en el panel Mi Horario.`,
        { shift_id: shift._id }
    );
}

// ─── Vacaciones y permisos ────────────────────────────────────────────────────

/**
 * Notifica al empleado que su solicitud de vacaciones ha sido aprobada.
 */
async function notifyVacationApproved(employee, vacation) {
    const start = new Date(vacation.start_date).toLocaleDateString('es-ES');
    const end   = new Date(vacation.end_date).toLocaleDateString('es-ES');
    return createInAppNotification(
        employee._id,
        'vacation_approved',
        'Vacaciones aprobadas',
        `Tu solicitud de vacaciones del ${start} al ${end} (${vacation.days} día${vacation.days !== 1 ? 's' : ''}) ha sido aprobada.`,
        { vacation_id: vacation._id }
    );
}

/**
 * Notifica al empleado que su solicitud de vacaciones/permiso ha sido rechazada.
 */
async function notifyVacationRejected(employee, vacation) {
    const start = new Date(vacation.start_date).toLocaleDateString('es-ES');
    const end   = new Date(vacation.end_date).toLocaleDateString('es-ES');
    const reason = vacation.rejection_reason ? ` Motivo: ${vacation.rejection_reason}.` : '';
    return createInAppNotification(
        employee._id,
        'vacation_rejected',
        'Solicitud rechazada',
        `Tu solicitud del ${start} al ${end} ha sido rechazada.${reason}`,
        { vacation_id: vacation._id }
    );
}

module.exports = {
    createInAppNotification,
    notifyShiftPublished,
    notifyShiftAssigned,
    notifyShiftUnassigned,
    notifyShiftChanged,
    notifyVacationApproved,
    notifyVacationRejected,
};
