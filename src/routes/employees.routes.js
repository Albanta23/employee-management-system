const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { requireFeatureAccess, getStoreLocations, getStoreEmployeeIds, ensureEmployeeInScope, isStoreCoordinator } = require('../utils/accessScope');

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
        res.status(500).json({ error: 'Error al obtener trabajador' });
    }
});

// Crear nuevo trabajador
router.post('/', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const { full_name, dni, phone, email, position, location, salary, hire_date, notes, convention, annual_vacation_days, enableAccess, username, password } = req.body;

        if (!full_name || !dni || !phone || !position || !location) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const parsedAnnualVacationDays = annual_vacation_days === undefined || annual_vacation_days === null || annual_vacation_days === ''
            ? undefined
            : Number(annual_vacation_days);
        if (parsedAnnualVacationDays !== undefined && (!Number.isFinite(parsedAnnualVacationDays) || parsedAnnualVacationDays < 0)) {
            return res.status(400).json({ error: 'annual_vacation_days debe ser un número >= 0' });
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
            // Empleado solo puede actualizar email y teléfono de su propio perfil
            const { email, phone } = req.body;
            const update = {};
            if (email !== undefined) update.email = email;
            if (phone !== undefined) update.phone = phone;
            
            const employee = await Employee.findByIdAndUpdate(req.params.id, update, { new: true });
            if (!employee) return res.status(404).json({ error: 'Trabajador no encontrado' });
            
            return res.json({ message: 'Perfil actualizado correctamente' });
        }

        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const inScope = await ensureEmployeeInScope(req, res, req.params.id);
        if (!inScope) return;

        const { full_name, dni, phone, email, position, location, salary, status, notes, convention, hire_date, annual_vacation_days, enableAccess, username, password } = req.body;

        const parsedAnnualVacationDays = annual_vacation_days === undefined || annual_vacation_days === null || annual_vacation_days === ''
            ? undefined
            : Number(annual_vacation_days);
        if (parsedAnnualVacationDays !== undefined && (!Number.isFinite(parsedAnnualVacationDays) || parsedAnnualVacationDays < 0)) {
            return res.status(400).json({ error: 'annual_vacation_days debe ser un número >= 0' });
        }

        if (isStoreCoordinator(req.user) && location) {
            const storeLocations = await getStoreLocations();
            if (!storeLocations.includes(String(location))) {
                return res.status(403).json({ error: 'No puedes mover un empleado fuera de las tiendas configuradas' });
            }
        }

        const update = { full_name, dni, phone, email, position, location, salary, status, notes, convention, hire_date };
        if (parsedAnnualVacationDays !== undefined) update.annual_vacation_days = parsedAnnualVacationDays;

        const employee = await Employee.findByIdAndUpdate(req.params.id, update, { new: true });

        if (!employee) return res.status(404).json({ error: 'Trabajador no encontrado' });

        if (enableAccess && username) {
            const userUpdate = { username, name: full_name, email };
            if (password) userUpdate.password = await bcrypt.hash(password, 10);

            await User.findOneAndUpdate(
                { employee_id: employee._id },
                { $set: userUpdate, $setOnInsert: { role: 'employee', employee_id: employee._id } },
                { upsert: true }
            );
        }

        res.json({ message: 'Trabajador actualizado correctamente' });

    } catch (error) {
        console.error('Error al actualizar trabajador:', error);
        res.status(500).json({ error: 'Error al actualizar trabajador' });
    }
});

// Eliminar trabajador (baja definitiva)
router.delete('/:id', async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'employees');
        if (!hasAccess) return;

        const inScope = await ensureEmployeeInScope(req, res, req.params.id);
        if (!inScope) return;

        const employee = await Employee.findByIdAndUpdate(req.params.id, {
            status: 'inactive',
            termination_date: new Date()
        });

        if (!employee) return res.status(404).json({ error: 'Trabajador no encontrado' });
        res.json({ message: 'Trabajador dado de baja correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar trabajador' });
    }
});

module.exports = router;
