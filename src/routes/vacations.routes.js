const express = require('express');
const router = express.Router();
const Vacation = require('../models/Vacation');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, ensureEmployeeInScope, isStoreCoordinator, getStoreLocations, getStoreEmployeeIds } = require('../utils/accessScope');

router.use(authenticateToken);

function getFeatureKeyForType(type) {
    return String(type || '').toLowerCase() === 'vacation' ? 'vacations' : 'permissions';
}

function parseYear(value) {
    const year = Number.parseInt(String(value || ''), 10);
    const nowYear = new Date().getFullYear();
    if (!Number.isFinite(year)) return nowYear;
    if (year < 1970 || year > 3000) return nowYear;
    return year;
}

function sumDaysByStatus(items, status) {
    return items
        .filter(v => (v.status || 'pending') === status)
        .reduce((acc, v) => acc + (Number(v.days) || 0), 0);
}

async function getEmployeeInScope(req, res, employeeId) {
    const ok = await ensureEmployeeInScope(req, res, employeeId);
    if (!ok) return null;
    const employee = await Employee.findById(employeeId).lean();
    if (!employee) {
        res.status(404).json({ error: 'Empleado no encontrado' });
        return null;
    }
    return employee;
}

async function buildTimeOffBalanceForEmployee(employeeId, year) {
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);

    const items = await Vacation.find({
        employee_id: employeeId,
        start_date: { $lte: end },
        end_date: { $gte: start }
    }).lean();

    const vacations = items.filter(v => (v.type || 'vacation') === 'vacation');
    const permissions = items.filter(v => (v.type || 'vacation') !== 'vacation');

    const vacationApproved = sumDaysByStatus(vacations, 'approved');
    const vacationPending = sumDaysByStatus(vacations, 'pending');
    const vacationRejected = sumDaysByStatus(vacations, 'rejected');

    const permApproved = sumDaysByStatus(permissions, 'approved');
    const permPending = sumDaysByStatus(permissions, 'pending');
    const permRejected = sumDaysByStatus(permissions, 'rejected');

    return {
        year,
        employee_id: String(employeeId),
        vacation: {
            allowance_days: null,
            approved_days: vacationApproved,
            pending_days: vacationPending,
            rejected_days: vacationRejected,
            remaining_after_approved: null,
            remaining_after_pending: null
        },
        permissions: {
            approved_days: permApproved,
            pending_days: permPending,
            rejected_days: permRejected
        }
    };
}

// Saldo de vacaciones/permisos por empleado (por año)
router.get('/balance', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'vacations');
        if (!hasAccess) return;

        const { employee_id } = req.query;
        if (!employee_id) {
            return res.status(400).json({ error: 'employee_id es requerido' });
        }

        const year = parseYear(req.query.year);
        const employee = await getEmployeeInScope(req, res, employee_id);
        if (!employee) return;

        const balance = await buildTimeOffBalanceForEmployee(employee_id, year);

        const allowance = Number(employee.annual_vacation_days);
        const allowanceDays = Number.isFinite(allowance) ? allowance : 30;
        balance.vacation.allowance_days = allowanceDays;
        balance.vacation.remaining_after_approved = Math.max(0, allowanceDays - balance.vacation.approved_days);
        balance.vacation.remaining_after_pending = Math.max(0, allowanceDays - balance.vacation.approved_days - balance.vacation.pending_days);

        res.json(balance);
    } catch (error) {
        console.error('Error al obtener saldo:', error);
        res.status(500).json({ error: 'Error al obtener saldo' });
    }
});

// Saldos por año para todos los empleados en scope (útil para administración/reportes)
router.get('/balances', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'vacations');
        if (!hasAccess) return;

        const year = parseYear(req.query.year);

        const { employee_ids, status, location } = req.query;
        const employeesQuery = {};

        // Por defecto, el endpoint histórico devolvía solo activos.
        // Mantenemos ese comportamiento si no se especifica nada.
        if (status) {
            employeesQuery.status = String(status);
        } else if (!employee_ids) {
            employeesQuery.status = 'active';
        }

        if (location) {
            employeesQuery.location = String(location);
        }

        if (employee_ids) {
            const ids = String(employee_ids)
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            // Evitar consultas excesivas por URL muy grande
            const cappedIds = ids.slice(0, 1000);
            employeesQuery._id = { $in: cappedIds };
        }

        if (isStoreCoordinator(req.user)) {
            // Para coordinadores, limitamos al scope permitido.
            if (employeesQuery._id && employeesQuery._id.$in) {
                const storeEmployeeIds = await getStoreEmployeeIds();
                const allowed = new Set((storeEmployeeIds || []).map(String));
                employeesQuery._id.$in = employeesQuery._id.$in.filter(id => allowed.has(String(id)));
            } else {
                const storeLocations = await getStoreLocations();
                employeesQuery.location = { $in: storeLocations };

                // Si además venía un location, lo intersectamos
                if (location) {
                    employeesQuery.location = { $in: storeLocations.filter(l => l === String(location)) };
                }
            }
        }

        const employees = await Employee.find(employeesQuery)
            .select('_id annual_vacation_days full_name dni position location')
            .lean();

        const balances = [];
        for (const e of employees) {
            const employeeId = e._id;
            const balance = await buildTimeOffBalanceForEmployee(employeeId, year);

            const allowance = Number(e.annual_vacation_days);
            const allowanceDays = Number.isFinite(allowance) ? allowance : 30;
            balance.vacation.allowance_days = allowanceDays;
            balance.vacation.remaining_after_approved = Math.max(0, allowanceDays - balance.vacation.approved_days);
            balance.vacation.remaining_after_pending = Math.max(0, allowanceDays - balance.vacation.approved_days - balance.vacation.pending_days);

            balance.employee = {
                id: String(e._id),
                full_name: e.full_name,
                dni: e.dni,
                position: e.position,
                location: e.location
            };

            balances.push(balance);
        }

        res.json({ year, balances });
    } catch (error) {
        console.error('Error al obtener saldos:', error);
        res.status(500).json({ error: 'Error al obtener saldos' });
    }
});

// Obtener todas las vacaciones con filtros
router.get('/', async (req, res) => {
    try {
        // vacations.html llama con type=vacation; permissions.html llama sin type y filtra en cliente.
        const featureKey = req.query && 'type' in req.query
            ? getFeatureKeyForType(req.query.type)
            : 'permissions';

        const hasAccess = await requireFeatureAccess(req, res, featureKey);
        if (!hasAccess) return;

        const { employee_id, status, year, type } = req.query;
        const query = {};

        if (employee_id) {
            const ok = await ensureEmployeeInScope(req, res, employee_id);
            if (!ok) return;
            query.employee_id = employee_id;
        }
        if (status) query.status = status;
        if (type) query.type = type;
        if (year) {
            query.start_date = {
                $gte: new Date(`${year}-01-01`),
                $lte: new Date(`${year}-12-31`)
            };
        }

        if (isStoreCoordinator(req.user) && !employee_id) {
            const ids = await getStoreEmployeeIds();
            query.employee_id = { $in: ids };
        }

        const vacations = await Vacation.find(query)
            .populate('employee_id', 'full_name dni position location')
            .sort({ start_date: -1 })
            .lean()
            .exec();

        // Mapear para mantener compatibilidad con el frontend (id y nombres planos)
        const formattedVacations = vacations.map(v => ({
            ...v,
            id: v._id.toString(),
            _id: v._id.toString(),
            full_name: v.employee_id?.full_name,
            dni: v.employee_id?.dni,
            position: v.employee_id?.position,
            location: v.employee_id?.location,
            employee_id: v.employee_id?._id.toString()
        }));

        res.json(formattedVacations);

    } catch (error) {
        console.error('Error al obtener vacaciones:', error);
        res.status(500).json({ error: 'Error al obtener vacaciones' });
    }
});

const { calculateVacationDays } = require('../utils/dateUtils');

// Crear solicitud de vacaciones
router.post('/', async (req, res) => {
    try {
        const featureKey = getFeatureKeyForType(req.body?.type);
        const hasAccess = await requireFeatureAccess(req, res, featureKey);
        if (!hasAccess) return;

        const { employee_id, start_date, end_date, type, reason } = req.body;

        if (!employee_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const employee = await Employee.findById(employee_id);
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const ok = await ensureEmployeeInScope(req, res, employee_id);
        if (!ok) return;

        // Cálculo automático de días reales (naturales menos festivos/findes según convenio)
        const days = await calculateVacationDays(new Date(start_date), new Date(end_date), employee.location);

        const vacation = new Vacation({
            employee_id, start_date, end_date, days, type, reason, status: 'pending'
        });

        await vacation.save();
        res.status(201).json({ id: vacation._id, days, message: 'Solicitud creada correctamente' });

    } catch (error) {
        console.error('Error al crear solicitud:', error);
        res.status(500).json({ error: 'Error al crear solicitud' });
    }
});

// Actualizar solicitud de vacación
router.put('/:id', async (req, res) => {
    try {
        const { status, reason, start_date, end_date, type, days } = req.body;
        const update = {};

        // Si se envía status, es una aprobación/rechazo (normalmente admin)
        if (status) {
            update.status = status;
            if (status === 'approved') {
                update.approved_by = req.user.id;
                update.approved_date = new Date();
            }
        }

        // Permitir actualizar datos si es pendiente o si se fuerzan los datos
        const existing = await Vacation.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Solicitud no encontrada' });

        const featureKey = getFeatureKeyForType(existing.type);
        const hasAccess = await requireFeatureAccess(req, res, featureKey);
        if (!hasAccess) return;

        const ok = await ensureEmployeeInScope(req, res, existing.employee_id);
        if (!ok) return;

        if (existing.status === 'pending' || req.user.role === 'admin' || req.user.role === 'store_coordinator') {
            if (start_date) update.start_date = start_date;
            if (end_date) update.end_date = end_date;
            if (type) update.type = type;
            if (reason) update.reason = reason;
            if (days) update.days = days;
        }

        const vacation = await Vacation.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json({ message: 'Solicitud actualizada correctamente', vacation });

    } catch (error) {
        console.error('Error al actualizar solicitud:', error);
        res.status(500).json({ error: 'Error al actualizar solicitud' });
    }
});

// Obtener una solicitud por ID
router.get('/:id', async (req, res) => {
    try {
        const vacation = await Vacation.findById(req.params.id).populate('employee_id');
        if (!vacation) return res.status(404).json({ error: 'Solicitud no encontrada' });

        const featureKey = getFeatureKeyForType(vacation.type);
        const hasAccess = await requireFeatureAccess(req, res, featureKey);
        if (!hasAccess) return;

        const ok = await ensureEmployeeInScope(req, res, vacation.employee_id?._id);
        if (!ok) return;

        res.json({
            ...vacation._doc,
            id: vacation._id,
            full_name: vacation.employee_id?.full_name,
            dni: vacation.employee_id?.dni,
            position: vacation.employee_id?.position,
            location: vacation.employee_id?.location
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener solicitud' });
    }
});

// Eliminar solicitud
router.delete('/:id', async (req, res) => {
    try {
        const existing = await Vacation.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Solicitud no encontrada' });

        const featureKey = getFeatureKeyForType(existing.type);
        const hasAccess = await requireFeatureAccess(req, res, featureKey);
        if (!hasAccess) return;

        const ok = await ensureEmployeeInScope(req, res, existing.employee_id);
        if (!ok) return;

        await Vacation.findByIdAndDelete(req.params.id);
        res.json({ message: 'Solicitud eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar solicitud' });
    }
});

module.exports = router;
