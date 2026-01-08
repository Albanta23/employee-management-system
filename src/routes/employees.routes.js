const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { requireFeatureAccess, getStoreLocations, getStoreEmployeeIds, ensureEmployeeInScope, isStoreCoordinator } = require('../utils/accessScope');
const { logAudit, pick, shallowDiff } = require('../utils/audit');
const Location = require('../models/Location');
const logger = require('../utils/logger');

function normalizeForCompare(value) {
    const s = (value == null ? '' : String(value)).trim();
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isFactoryName(value) {
    const normalized = normalizeForCompare(value);
    if (!normalized) return false;
    return normalized.includes('fabrica') || normalized.includes('factory');
}

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// Obtener todos los trabajadores con filtros y paginación
router.get('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const { page = 1, limit = 50, search = '', location = '', position = '', status = 'active' } = req.query;

        const query = { status };

        if (search) {
            query.$or = [
                { full_name: { $regex: search, $options: 'i' } },
                { dni: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        if (location) query.location = location;
        if (position) query.position = position;

        if (isStoreCoordinator(req.user)) {
            const storeLocations = await getStoreLocations();
            query.location = { $in: storeLocations };
            // Si además venía un location, lo intersectamos
            if (location) {
                query.location = { $in: storeLocations.filter(l => l === String(location)) };
            }
        }

        const employees = await Employee.find(query)
            .sort({ full_name: 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean()
            .exec();

        const formattedEmployees = employees.map(e => ({
            ...e,
            id: e._id.toString(),
            _id: e._id.toString()
        }));

        const count = await Employee.countDocuments(query);

        res.json({
            employees: formattedEmployees,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });

    } catch (error) {
        console.error('Error al obtener trabajadores:', error);
        res.status(500).json({ error: 'Error al obtener trabajadores' });
    }
});

// Obtener estadísticas generales
router.get('/stats', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'dashboard');
        if (!hasAccess) return;

        const stats = {};

        const employeeMatch = { status: 'active' };
        if (isStoreCoordinator(req.user)) {
            const storeLocations = await getStoreLocations();
            employeeMatch.location = { $in: storeLocations };
        }

        // Total de empleados activos
        stats.totalActive = await Employee.countDocuments(employeeMatch);

        // Por ubicación
        stats.byLocation = await Employee.aggregate([
            { $match: employeeMatch },
            { $group: { _id: '$location', count: { $sum: 1 } } },
            { $project: { location: '$_id', count: 1, _id: 0 } },
            { $sort: { count: -1 } }
        ]);

        // Por puesto
        stats.byPosition = await Employee.aggregate([
            { $match: employeeMatch },
            { $group: { _id: '$position', count: { $sum: 1 } } },
            { $project: { position: '$_id', count: 1, _id: 0 } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        // Vacaciones pendientes (Se asume modelo Vacation existe)
        const Vacation = require('../models/Vacation');
        let storeEmployeeIds = null;
        if (isStoreCoordinator(req.user)) {
            storeEmployeeIds = await getStoreEmployeeIds();
        }

        if (storeEmployeeIds) {
            stats.vacationsPending = await Vacation.countDocuments({
                status: 'pending',
                type: 'vacation',
                employee_id: { $in: storeEmployeeIds }
            });
        } else {
            stats.vacationsPending = await Vacation.countDocuments({ status: 'pending', type: 'vacation' });
        }

        // Bajas activas
        const Absence = require('../models/Absence');
        if (storeEmployeeIds) {
            stats.activeAbsences = await Absence.countDocuments({ status: 'active', employee_id: { $in: storeEmployeeIds } });
        } else {
            stats.activeAbsences = await Absence.countDocuments({ status: 'active' });
        }

        // Permisos pendientes
        if (storeEmployeeIds) {
            stats.pendingPermissions = await Vacation.countDocuments({ status: 'pending', type: { $ne: 'vacation' }, employee_id: { $in: storeEmployeeIds } });
        } else {
            stats.pendingPermissions = await Vacation.countDocuments({ status: 'pending', type: { $ne: 'vacation' } });
        }

        res.json(stats);

    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// Obtener perfil del empleado autenticado (para portal del empleado)
router.get('/me', async (req, res) => {
    try {
        // Cualquier usuario autenticado con employee_id puede ver su propio perfil
        if (!req.user || !req.user.employee_id) {
            return res.status(403).json({ error: 'No tienes un perfil de empleado asociado' });
        }

        const employee = await Employee.findById(req.user.employee_id).lean();
        if (!employee) return res.status(404).json({ error: 'Perfil de empleado no encontrado' });
        res.json({ ...employee, id: employee._id.toString(), _id: employee._id.toString() });
    } catch (error) {
        console.error('Error al obtener perfil:', error);
        res.status(500).json({ error: 'Error al obtener perfil' });
    }
});

// Obtener un trabajador por ID
router.get('/:id', async (req, res) => {
    try {
        // Permitir que un empleado acceda a su propio perfil
        const isOwnProfile = req.user && req.user.employee_id && req.user.employee_id === req.params.id;
        
        if (!isOwnProfile) {
            const hasAccess = await requireFeatureAccess(req, res, 'employees');
            if (!hasAccess) return;

            const inScope = await ensureEmployeeInScope(req, res, req.params.id);
            if (!inScope) return;
        }

        const employee = await Employee.findById(req.params.id).lean();
        if (!employee) return res.status(404).json({ error: 'Trabajador no encontrado' });
        res.json({ ...employee, id: employee._id.toString(), _id: employee._id.toString() });
    } catch (error) {
        logger.error('employees_get_by_id_error', {
            requestId: String(req.requestId || ''),
            employeeId: String(req.params.id || ''),
            error: error && error.message ? error.message : String(error),
            stack: error && error.stack ? String(error.stack).split('\n').slice(0, 8).join('\n') : undefined
        });
        res.status(500).json({ error: 'Error al obtener trabajador', requestId: req.requestId });
    }
});

// Crear nuevo trabajador
router.post('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const { full_name, dni, phone, email, position, location, salary, hire_date, notes, convention, annual_vacation_days, vacation_carryover_days, enableAccess, username, password } = req.body;

        if (!full_name || !dni || !phone || !position || !location) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const parsedAnnualVacationDays = annual_vacation_days === undefined || annual_vacation_days === null || annual_vacation_days === ''
            ? undefined
            : Number(annual_vacation_days);
        if (parsedAnnualVacationDays !== undefined && (!Number.isFinite(parsedAnnualVacationDays) || parsedAnnualVacationDays < 0)) {
            return res.status(400).json({ error: 'annual_vacation_days debe ser un número >= 0' });
        }

        const parsedCarryoverDays = vacation_carryover_days === undefined || vacation_carryover_days === null || vacation_carryover_days === ''
            ? undefined
            : Number(vacation_carryover_days);
        if (parsedCarryoverDays !== undefined && (!Number.isFinite(parsedCarryoverDays) || parsedCarryoverDays < 0)) {
            return res.status(400).json({ error: 'vacation_carryover_days debe ser un número >= 0' });
        }

        const employee = new Employee({
            full_name,
            dni,
            phone,
            email,
            position,
            location,
            salary,
            hire_date: hire_date || new Date(),
            notes,
            convention,
            annual_vacation_days: parsedAnnualVacationDays,
            vacation_carryover_days: parsedCarryoverDays,
            status: 'active'
        });

        if (isStoreCoordinator(req.user)) {
            const storeLocations = await getStoreLocations();
            if (!storeLocations.includes(String(location))) {
                return res.status(403).json({ error: 'Solo puedes crear empleados en ubicaciones de tienda configuradas' });
            }
        }

        await employee.save();

        if (enableAccess && username && password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            const user = new User({
                username,
                password: hashedPassword,
                name: full_name,
                email: email,
                role: 'employee',
                employee_id: employee._id
            });
            await user.save();
        }

        res.status(201).json({ id: employee._id, message: 'Trabajador creado correctamente' });

    } catch (error) {
        console.error('Error al crear trabajador:', error);
        if (error.code === 11000) {
            res.status(409).json({ error: 'Ya existe un trabajador con ese DNI' });
        } else {
            res.status(500).json({ error: 'Error al crear trabajador' });
        }
    }
});

// Actualizar trabajador
router.put('/:id', async (req, res) => {
    try {
        // Permitir que un empleado actualice su propio perfil (solo email y teléfono)
        const isOwnProfile = req.user && req.user.employee_id && req.user.employee_id === req.params.id;
        
        if (isOwnProfile) {
            function isValidTimeHHmm(value) {
                if (typeof value !== 'string') return false;
                const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
                return Boolean(m);
            }

            function isValidDateYYYYMMDD(value) {
                if (typeof value !== 'string') return false;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
                const d = new Date(`${value}T00:00:00.000Z`);
                return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
            }

            function normalizeBreakPair(obj, target) {
                if (obj.break_start !== undefined) {
                    if (obj.break_start !== '' && !isValidTimeHHmm(obj.break_start)) throw new Error('break_start debe tener formato HH:mm o vacío');
                    target.break_start = obj.break_start;
                }

                if (obj.break_end !== undefined) {
                    if (obj.break_end !== '' && !isValidTimeHHmm(obj.break_end)) throw new Error('break_end debe tener formato HH:mm o vacío');
                    target.break_end = obj.break_end;
                }

                const hasBreakStart = Object.prototype.hasOwnProperty.call(target, 'break_start') ? target.break_start : obj.break_start;
                const hasBreakEnd = Object.prototype.hasOwnProperty.call(target, 'break_end') ? target.break_end : obj.break_end;
                if ((hasBreakStart && !hasBreakEnd) || (!hasBreakStart && hasBreakEnd)) {
                    throw new Error('Para usar descanso, deben indicarse break_start y break_end');
                }
            }

            function normalizeDayOverride(override) {
                if (!override || typeof override !== 'object') return null;
                const out = {};
                if (override.enabled !== undefined) out.enabled = Boolean(override.enabled);

                if (override.start_time !== undefined) {
                    if (override.start_time !== '' && !isValidTimeHHmm(override.start_time)) throw new Error('day_overrides.start_time debe tener formato HH:mm o vacío');
                    out.start_time = override.start_time;
                }

                if (override.end_time !== undefined) {
                    if (override.end_time !== '' && !isValidTimeHHmm(override.end_time)) throw new Error('day_overrides.end_time debe tener formato HH:mm o vacío');
                    out.end_time = override.end_time;
                }

                normalizeBreakPair(override, out);

                // Si el override está habilitado, exigimos start/end no vacíos
                const enabled = Object.prototype.hasOwnProperty.call(out, 'enabled') ? out.enabled : Boolean(override.enabled);
                if (enabled === true) {
                    const st = Object.prototype.hasOwnProperty.call(out, 'start_time') ? out.start_time : override.start_time;
                    const et = Object.prototype.hasOwnProperty.call(out, 'end_time') ? out.end_time : override.end_time;
                    if (!st || !et) throw new Error('day_overrides: si enabled=true, start_time y end_time son requeridos');
                    if (!isValidTimeHHmm(st) || !isValidTimeHHmm(et)) throw new Error('day_overrides: start_time/end_time inválidos');
                }

                return out;
            }

            function normalizeDateOverride(item) {
                if (!item || typeof item !== 'object') throw new Error('date_overrides debe ser un array de objetos');
                if (!isValidDateYYYYMMDD(item.date)) throw new Error('date_overrides.date debe tener formato YYYY-MM-DD');
                const out = { date: item.date };
                if (item.enabled !== undefined) out.enabled = Boolean(item.enabled);

                if (item.start_time !== undefined) {
                    if (item.start_time !== '' && !isValidTimeHHmm(item.start_time)) throw new Error('date_overrides.start_time debe tener formato HH:mm o vacío');
                    out.start_time = item.start_time;
                }

                if (item.end_time !== undefined) {
                    if (item.end_time !== '' && !isValidTimeHHmm(item.end_time)) throw new Error('date_overrides.end_time debe tener formato HH:mm o vacío');
                    out.end_time = item.end_time;
                }

                normalizeBreakPair(item, out);

                const enabled = Object.prototype.hasOwnProperty.call(out, 'enabled') ? out.enabled : true;
                if (enabled === true) {
                    const st = Object.prototype.hasOwnProperty.call(out, 'start_time') ? out.start_time : item.start_time;
                    const et = Object.prototype.hasOwnProperty.call(out, 'end_time') ? out.end_time : item.end_time;
                    if (!st || !et) throw new Error('date_overrides: si enabled=true, start_time y end_time son requeridos');
                    if (!isValidTimeHHmm(st) || !isValidTimeHHmm(et)) throw new Error('date_overrides: start_time/end_time inválidos');
                }

                return out;
            }

            function normalizeSchedule(schedule) {
                if (!schedule || typeof schedule !== 'object') return null;

                const normalized = {};
                if (schedule.enabled !== undefined) normalized.enabled = Boolean(schedule.enabled);

                if (schedule.days_of_week !== undefined) {
                    if (!Array.isArray(schedule.days_of_week)) {
                        throw new Error('days_of_week debe ser un array');
                    }
                    const days = schedule.days_of_week
                        .map((d) => Number(d))
                        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
                    normalized.days_of_week = Array.from(new Set(days));
                }

                if (schedule.start_time !== undefined) {
                    if (!isValidTimeHHmm(schedule.start_time)) throw new Error('start_time debe tener formato HH:mm');
                    normalized.start_time = schedule.start_time;
                }

                if (schedule.end_time !== undefined) {
                    if (!isValidTimeHHmm(schedule.end_time)) throw new Error('end_time debe tener formato HH:mm');
                    normalized.end_time = schedule.end_time;
                }

                if (schedule.break_start !== undefined) {
                    if (schedule.break_start !== '' && !isValidTimeHHmm(schedule.break_start)) throw new Error('break_start debe tener formato HH:mm o vacío');
                    normalized.break_start = schedule.break_start;
                }

                if (schedule.break_end !== undefined) {
                    if (schedule.break_end !== '' && !isValidTimeHHmm(schedule.break_end)) throw new Error('break_end debe tener formato HH:mm o vacío');
                    normalized.break_end = schedule.break_end;
                }

                if (schedule.tolerance_minutes !== undefined) {
                    const tol = Number(schedule.tolerance_minutes);
                    if (!Number.isFinite(tol) || tol < 0 || tol > 180) throw new Error('tolerance_minutes debe ser un número entre 0 y 180');
                    normalized.tolerance_minutes = Math.round(tol);
                }

                if (schedule.day_overrides !== undefined) {
                    if (!schedule.day_overrides || typeof schedule.day_overrides !== 'object' || Array.isArray(schedule.day_overrides)) {
                        throw new Error('day_overrides debe ser un objeto');
                    }

                    const out = {};
                    for (const [k, v] of Object.entries(schedule.day_overrides)) {
                        const dow = Number(k);
                        if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
                        const normalizedOverride = normalizeDayOverride(v);
                        if (normalizedOverride) out[String(dow)] = normalizedOverride;
                    }
                    normalized.day_overrides = out;
                }

                if (schedule.date_overrides !== undefined) {
                    if (!Array.isArray(schedule.date_overrides)) throw new Error('date_overrides debe ser un array');
                    if (schedule.date_overrides.length > 366) throw new Error('date_overrides: máximo 366 elementos');

                    const items = schedule.date_overrides.map(normalizeDateOverride);
                    // Deduplicar por fecha (última gana)
                    const byDate = new Map();
                    for (const it of items) byDate.set(it.date, it);
                    normalized.date_overrides = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
                }

                // Validación cruzada mínima de descanso: o vienen ambos o ninguno
                const hasBreakStart = Object.prototype.hasOwnProperty.call(normalized, 'break_start') ? normalized.break_start : schedule.break_start;
                const hasBreakEnd = Object.prototype.hasOwnProperty.call(normalized, 'break_end') ? normalized.break_end : schedule.break_end;

                if ((hasBreakStart && !hasBreakEnd) || (!hasBreakStart && hasBreakEnd)) {
                    throw new Error('Para usar descanso, deben indicarse break_start y break_end');
                }

                return normalized;
            }

            // Empleado puede actualizar email, teléfono y su horario
            const { email, phone, work_schedule } = req.body;
            const update = {};
            if (email !== undefined) update.email = email;
            if (phone !== undefined) update.phone = phone;

            if (work_schedule !== undefined) {
                try {
                    const normalized = normalizeSchedule(work_schedule);
                    if (normalized) update.work_schedule = normalized;
                } catch (e) {
                    return res.status(400).json({ error: e.message || 'work_schedule inválido' });
                }
            }
            
            const beforeDoc = await Employee.findById(req.params.id).lean();
            const before = pick(beforeDoc || {}, ['_id', 'email', 'phone', 'work_schedule']);

            const employee = await Employee.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
            if (!employee) return res.status(404).json({ error: 'Trabajador no encontrado' });

            const after = pick(employee || {}, ['_id', 'email', 'phone', 'work_schedule']);
            const changed = shallowDiff(before, after);
            await logAudit({
                req,
                action: 'employee.self_update',
                entityType: 'Employee',
                entityId: String(req.params.id),
                employeeId: String(req.params.id),
                employeeLocation: String((employee && employee.location) || ''),
                before,
                after,
                meta: { changed }
            });
            
            return res.json({ message: 'Perfil actualizado correctamente' });
        }

        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const inScope = await ensureEmployeeInScope(req, res, req.params.id);
        if (!inScope) return;

        const { full_name, dni, phone, email, position, location, salary, status, notes, convention, hire_date, annual_vacation_days, vacation_carryover_days, enableAccess, username, password } = req.body;

        function parseOptionalNumberOrNull(value, fieldName) {
            if (value === undefined) return { hasValue: false };
            if (value === null || value === '') return { hasValue: true, value: null };
            const n = Number(value);
            if (!Number.isFinite(n)) {
                return { hasValue: true, error: `${fieldName} debe ser un número válido` };
            }
            return { hasValue: true, value: n };
        }

        function parseOptionalDateOrNull(value, fieldName) {
            if (value === undefined) return { hasValue: false };
            if (value === null || value === '') return { hasValue: true, value: null };
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) {
                return { hasValue: true, error: `${fieldName} debe ser una fecha válida` };
            }
            return { hasValue: true, value: d };
        }

        // Permitir limpiar annual_vacation_days enviando '' o null. Si no se envía, no se toca.
        let parsedAnnualVacationDays = undefined;
        let annualVacationDaysWantsNull = false;
        if (annual_vacation_days !== undefined) {
            if (annual_vacation_days === null || annual_vacation_days === '') {
                annualVacationDaysWantsNull = true;
            } else {
                parsedAnnualVacationDays = Number(annual_vacation_days);
                if (!Number.isFinite(parsedAnnualVacationDays) || parsedAnnualVacationDays < 0) {
                    return res.status(400).json({ error: 'annual_vacation_days debe ser un número >= 0' });
                }
            }
        }

        if (isStoreCoordinator(req.user) && location) {
            const storeLocations = await getStoreLocations();
            if (!storeLocations.includes(String(location))) {
                return res.status(403).json({ error: 'No puedes mover un empleado fuera de las tiendas configuradas' });
            }
        }

        const beforeDoc = await Employee.findById(req.params.id).lean();
        const before = pick(beforeDoc || {}, ['_id', 'full_name', 'dni', 'phone', 'email', 'position', 'location', 'salary', 'status', 'notes', 'convention', 'hire_date', 'termination_date', 'annual_vacation_days', 'vacation_carryover_days']);

        const update = {};
        if (full_name !== undefined) update.full_name = full_name;
        if (dni !== undefined) update.dni = dni;
        if (phone !== undefined) update.phone = phone;
        if (email !== undefined) update.email = email;
        if (position !== undefined) update.position = position;
        if (location !== undefined) update.location = location;
        if (status !== undefined) update.status = status;
        if (notes !== undefined) update.notes = notes;
        if (convention !== undefined) update.convention = convention;

        const salaryParsed = parseOptionalNumberOrNull(salary, 'salary');
        if (salaryParsed.hasValue) {
            if (salaryParsed.error) return res.status(400).json({ error: salaryParsed.error });
            update.salary = salaryParsed.value;
        }

        const hireDateParsed = parseOptionalDateOrNull(hire_date, 'hire_date');
        if (hireDateParsed.hasValue) {
            if (hireDateParsed.error) return res.status(400).json({ error: hireDateParsed.error });
            update.hire_date = hireDateParsed.value;
        }

        if (annualVacationDaysWantsNull) update.annual_vacation_days = null;
        else if (parsedAnnualVacationDays !== undefined) update.annual_vacation_days = parsedAnnualVacationDays;

        if (vacation_carryover_days !== undefined) {
            if (vacation_carryover_days === null || vacation_carryover_days === '') {
                update.vacation_carryover_days = 0;
            } else {
                const n = Number(vacation_carryover_days);
                if (!Number.isFinite(n) || n < 0) {
                    return res.status(400).json({ error: 'vacation_carryover_days debe ser un número >= 0' });
                }
                update.vacation_carryover_days = n;
            }
        }

        const employee = await Employee.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true, context: 'query' }).lean();

        if (!employee) return res.status(404).json({ error: 'Trabajador no encontrado' });

        const after = pick(employee || {}, ['_id', 'full_name', 'dni', 'phone', 'email', 'position', 'location', 'salary', 'status', 'notes', 'convention', 'hire_date', 'termination_date', 'annual_vacation_days', 'vacation_carryover_days']);
        const changed = shallowDiff(before, after);
        await logAudit({
            req,
            action: 'employee.update',
            entityType: 'Employee',
            entityId: String(req.params.id),
            employeeId: String(req.params.id),
            employeeLocation: String((employee && employee.location) || ''),
            before,
            after,
            meta: { changed }
        });

        if (enableAccess && username) {
            const userUpdate = { username, name: full_name, email };
            if (password) userUpdate.password = await bcrypt.hash(password, 10);

            // Si el username ya existe pero está huérfano (sin employee_id), lo reclamamos para este empleado
            // para evitar un 409 por unicidad cuando el admin está habilitando acceso desde el formulario.
            const existingByUsername = await User.findOne({ username })
                .select('_id employee_id')
                .lean();

            const currentUser = await User.findOne({ employee_id: employee._id })
                .select('_id username')
                .lean();

            if (
                existingByUsername &&
                (!existingByUsername.employee_id) &&
                (!currentUser) &&
                String(existingByUsername._id) !== String(employee._id)
            ) {
                await User.findByIdAndUpdate(
                    existingByUsername._id,
                    { $set: { ...userUpdate, role: 'employee', employee_id: employee._id } },
                    { new: true }
                );
            } else {
                await User.findOneAndUpdate(
                    { employee_id: employee._id },
                    { $set: userUpdate, $setOnInsert: { role: 'employee', employee_id: employee._id } },
                    { upsert: true }
                );
            }
        }

        res.json({ message: 'Trabajador actualizado correctamente' });

    } catch (error) {
        logger.error('employees_update_error', {
            requestId: String(req.requestId || ''),
            employeeId: String(req.params.id || ''),
            error: error && error.message ? error.message : String(error),
            name: error && error.name ? String(error.name) : undefined,
            stack: error && error.stack ? String(error.stack).split('\n').slice(0, 8).join('\n') : undefined
        });

        // Conflictos de unicidad (DNI duplicado, username duplicado, etc.)
        if (error && error.code === 11000) {
            const key = error.keyPattern
                ? Object.keys(error.keyPattern)[0]
                : (error.keyValue ? Object.keys(error.keyValue)[0] : null);

            const duplicateValue = (key && error.keyValue && Object.prototype.hasOwnProperty.call(error.keyValue, key))
                ? error.keyValue[key]
                : undefined;

            if (key === 'dni') {
                return res.status(409).json({
                    error: duplicateValue ? `Ya existe un trabajador con ese DNI (${duplicateValue})` : 'Ya existe un trabajador con ese DNI',
                    field: 'dni',
                    value: duplicateValue,
                    requestId: req.requestId
                });
            }

            if (key === 'username') {
                return res.status(409).json({
                    error: duplicateValue ? `Ya existe un usuario con ese nombre de usuario (${duplicateValue})` : 'Ya existe un usuario con ese nombre de usuario',
                    field: 'username',
                    value: duplicateValue,
                    requestId: req.requestId
                });
            }

            return res.status(409).json({
                error: 'Conflicto: dato duplicado',
                field: key || undefined,
                value: duplicateValue,
                requestId: req.requestId
            });
        }

        if (error && (error.name === 'CastError' || error.name === 'ValidationError')) {
            return res.status(400).json({ error: error.message || 'Datos inválidos', requestId: req.requestId });
        }

        res.status(500).json({ error: 'Error al actualizar trabajador', requestId: req.requestId });
    }
});

// Mover empleado de una tienda a otra (drag & drop)
router.post('/:id/move-store', async (req, res) => {
    try {
        // Solo admin: el coordinador tiene scope pero no debe reorganizar empleados.
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden mover empleados entre tiendas' });
        }

        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const { toStoreName } = req.body || {};
        const targetStoreName = String(toStoreName || '').trim();
        if (!targetStoreName) {
            return res.status(400).json({ error: 'toStoreName es requerido' });
        }

        // Validar que la tienda destino existe
        const targetLocation = await Location.findOne({
            active: true,
            'stores.name': targetStoreName
        }).lean();

        if (!targetLocation) {
            return res.status(400).json({ error: 'La tienda destino no existe en Ubicaciones' });
        }

        const beforeDoc = await Employee.findById(req.params.id).lean();
        if (!beforeDoc) return res.status(404).json({ error: 'Trabajador no encontrado' });

        const currentStoreName = String(beforeDoc.location || '').trim();

        if (currentStoreName === targetStoreName) {
            return res.json({ message: 'Sin cambios' });
        }

        const before = pick(beforeDoc || {}, ['_id', 'location']);
        const employee = await Employee.findByIdAndUpdate(
            req.params.id,
            { $set: { location: targetStoreName } },
            { new: true }
        ).lean();

        const after = pick(employee || {}, ['_id', 'location']);
        const changed = shallowDiff(before, after);
        await logAudit({
            req,
            action: 'employee.move_store',
            entityType: 'Employee',
            entityId: String(req.params.id),
            employeeId: String(req.params.id),
            employeeLocation: String((employee && employee.location) || ''),
            before,
            after,
            meta: { changed, from: currentStoreName, to: targetStoreName }
        });

        res.json({ message: 'Empleado movido correctamente' });
    } catch (error) {
        console.error('Error moviendo empleado de tienda:', error);
        res.status(500).json({ error: 'Error al mover empleado' });
    }
});

// Eliminar trabajador (baja definitiva)
router.delete('/:id', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const inScope = await ensureEmployeeInScope(req, res, req.params.id);
        if (!inScope) return;

        const beforeDoc = await Employee.findById(req.params.id).lean();
        const before = pick(beforeDoc || {}, ['_id', 'status', 'termination_date']);

        const employee = await Employee.findByIdAndUpdate(req.params.id, {
            status: 'inactive',
            termination_date: new Date()
        }, { new: true }).lean();

        if (!employee) return res.status(404).json({ error: 'Trabajador no encontrado' });

        const after = pick(employee || {}, ['_id', 'status', 'termination_date']);
        const changed = shallowDiff(before, after);
        await logAudit({
            req,
            action: 'employee.deactivate',
            entityType: 'Employee',
            entityId: String(req.params.id),
            employeeId: String(req.params.id),
            employeeLocation: String((employee && employee.location) || ''),
            before,
            after,
            meta: { changed }
        });

        res.json({ message: 'Trabajador dado de baja correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar trabajador' });
    }
});

module.exports = router;
