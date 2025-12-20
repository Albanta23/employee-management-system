const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const bcrypt = require('bcrypt');

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// Obtener todos los trabajadores con filtros y paginación
router.get('/', async (req, res) => {
    try {
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
        const stats = {};

        // Total de empleados activos
        stats.totalActive = await Employee.countDocuments({ status: 'active' });

        // Por ubicación
        stats.byLocation = await Employee.aggregate([
            { $match: { status: 'active' } },
            { $group: { _id: '$location', count: { $sum: 1 } } },
            { $project: { location: '$_id', count: 1, _id: 0 } },
            { $sort: { count: -1 } }
        ]);

        // Por puesto
        stats.byPosition = await Employee.aggregate([
            { $match: { status: 'active' } },
            { $group: { _id: '$position', count: { $sum: 1 } } },
            { $project: { position: '$_id', count: 1, _id: 0 } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        // Vacaciones pendientes (Se asume modelo Vacation existe)
        const Vacation = require('../models/Vacation');
        stats.vacationsPending = await Vacation.countDocuments({ status: 'pending', type: 'vacation' });

        // Bajas activas
        const Absence = require('../models/Absence');
        stats.activeAbsences = await Absence.countDocuments({ status: 'active' });

        // Permisos pendientes
        stats.pendingPermissions = await Vacation.countDocuments({ status: 'pending', type: { $ne: 'vacation' } });

        res.json(stats);

    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// Obtener un trabajador por ID
router.get('/:id', async (req, res) => {
    try {
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
        const { full_name, dni, phone, email, position, location, salary, hire_date, notes, convention, enableAccess, username, password } = req.body;

        if (!full_name || !dni || !phone || !position || !location) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const employee = new Employee({
            full_name, dni, phone, email, position, location, salary,
            hire_date: hire_date || new Date(),
            notes, convention, status: 'active'
        });

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
        const { full_name, dni, phone, email, position, location, salary, status, notes, convention, hire_date, enableAccess, username, password } = req.body;

        const employee = await Employee.findByIdAndUpdate(req.params.id, {
            full_name, dni, phone, email, position, location, salary, status, notes, convention, hire_date
        }, { new: true });

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
