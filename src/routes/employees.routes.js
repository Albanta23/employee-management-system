const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// Obtener todos los trabajadores con filtros y paginación
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', location = '', position = '', status = 'active' } = req.query;
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM employees WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM employees WHERE 1=1';
        const params = [];
        const countParams = [];

        // Filtros
        if (search) {
            query += ' AND (full_name LIKE ? OR dni LIKE ? OR email LIKE ? OR phone LIKE ?)';
            countQuery += ' AND (full_name LIKE ? OR dni LIKE ? OR email LIKE ? OR phone LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
            countParams.push(searchParam, searchParam, searchParam, searchParam);
        }

        if (location) {
            query += ' AND location = ?';
            countQuery += ' AND location = ?';
            params.push(location);
            countParams.push(location);
        }

        if (position) {
            query += ' AND position = ?';
            countQuery += ' AND position = ?';
            params.push(position);
            countParams.push(position);
        }

        if (status) {
            query += ' AND status = ?';
            countQuery += ' AND status = ?';
            params.push(status);
            countParams.push(status);
        }

        // Ordenar y paginar
        query += ' ORDER BY full_name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const employees = await dbAll(query, params);
        const totalResult = await dbGet(countQuery, countParams);

        res.json({
            employees,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalResult.total,
                pages: Math.ceil(totalResult.total / limit)
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

        // Total de empleados
        const totalResult = await dbGet('SELECT COUNT(*) as total FROM employees WHERE status = "active"');
        stats.totalActive = totalResult.total;

        // Por ubicación
        const byLocation = await dbAll(
            'SELECT location, COUNT(*) as count FROM employees WHERE status = "active" GROUP BY location ORDER BY count DESC'
        );
        stats.byLocation = byLocation;

        // Por puesto
        const byPosition = await dbAll(
            'SELECT position, COUNT(*) as count FROM employees WHERE status = "active" GROUP BY position ORDER BY count DESC LIMIT 10'
        );
        stats.byPosition = byPosition;

        // Vacaciones pendientes
        const vacationsPending = await dbGet(
            'SELECT COUNT(*) as count FROM vacations WHERE status = "pending"'
        );
        stats.vacationsPending = vacationsPending.count;

        // Bajas activas
        const activeAbsences = await dbGet(
            'SELECT COUNT(*) as count FROM absences WHERE status = "active"'
        );
        stats.activeAbsences = activeAbsences.count;

        // Permisos pendientes (asuntos propios, etc)
        const pendingPermissions = await dbGet(
            'SELECT COUNT(*) as count FROM vacations WHERE status = "pending" AND type != "vacation"'
        );
        stats.pendingPermissions = pendingPermissions.count;

        // Ajustar vacaciones pendientes para que solo cuente tipo 'vacation'
        const pendingVacations = await dbGet(
            'SELECT COUNT(*) as count FROM vacations WHERE status = "pending" AND type = "vacation"'
        );
        stats.vacationsPending = pendingVacations.count;

        res.json(stats);

    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// Obtener un trabajador por ID
router.get('/:id', async (req, res) => {
    try {
        const employee = await dbGet('SELECT * FROM employees WHERE id = ?', [req.params.id]);

        if (!employee) {
            return res.status(404).json({ error: 'Trabajador no encontrado' });
        }

        res.json(employee);

    } catch (error) {
        console.error('Error al obtener trabajador:', error);
        res.status(500).json({ error: 'Error al obtener trabajador' });
    }
});

// Crear nuevo trabajador
router.post('/', async (req, res) => {
    try {
        const { full_name, dni, phone, email, position, location, salary, hire_date, notes } = req.body;

        if (!full_name || !dni || !phone || !position || !location) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const result = await dbRun(
            `INSERT INTO employees (full_name, dni, phone, email, position, location, salary, hire_date, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [full_name, dni, phone, email || null, position, location, salary || null, hire_date || new Date().toISOString().split('T')[0], notes || null]
        );

        // Registrar en historial
        await dbRun(
            `INSERT INTO employment_records (employee_id, record_type, date, new_position, new_location, reason)
             VALUES (?, 'hire', ?, ?, ?, 'Alta inicial')`,
            [result.id, hire_date || new Date().toISOString().split('T')[0], position, location]
        );

        res.status(201).json({ id: result.id, message: 'Trabajador creado correctamente' });

    } catch (error) {
        console.error('Error al crear trabajador:', error);
        if (error.message.includes('UNIQUE constraint failed')) {
            res.status(409).json({ error: 'Ya existe un trabajador con ese DNI' });
        } else {
            res.status(500).json({ error: 'Error al crear trabajador' });
        }
    }
});

// Actualizar trabajador
router.put('/:id', async (req, res) => {
    try {
        const { full_name, dni, phone, email, position, location, salary, status, notes } = req.body;

        // Obtener datos actuales para el historial
        const currentEmployee = await dbGet('SELECT * FROM employees WHERE id = ?', [req.params.id]);

        if (!currentEmployee) {
            return res.status(404).json({ error: 'Trabajador no encontrado' });
        }

        const result = await dbRun(
            `UPDATE employees 
             SET full_name = ?, dni = ?, phone = ?, email = ?, position = ?, location = ?, 
                 salary = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [full_name, dni, phone, email, position, location, salary, status, notes, req.params.id]
        );

        // Registrar cambio de puesto o ubicación en el historial
        if (position !== currentEmployee.position || location !== currentEmployee.location) {
            await dbRun(
                `INSERT INTO employment_records (employee_id, record_type, date, previous_position, new_position, previous_location, new_location)
                 VALUES (?, 'position_change', ?, ?, ?, ?, ?)`,
                [req.params.id, new Date().toISOString().split('T')[0], currentEmployee.position, position, currentEmployee.location, location]
            );
        }

        res.json({ message: 'Trabajador actualizado correctamente', changes: result.changes });

    } catch (error) {
        console.error('Error al actualizar trabajador:', error);
        res.status(500).json({ error: 'Error al actualizar trabajador' });
    }
});

// Eliminar trabajador (baja definitiva)
router.delete('/:id', async (req, res) => {
    try {
        const employee = await dbGet('SELECT * FROM employees WHERE id = ?', [req.params.id]);

        if (!employee) {
            return res.status(404).json({ error: 'Trabajador no encontrado' });
        }

        // Marcar como inactivo en lugar de eliminar
        await dbRun(
            `UPDATE employees SET status = 'inactive', termination_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [new Date().toISOString().split('T')[0], req.params.id]
        );

        // Registrar en historial
        await dbRun(
            `INSERT INTO employment_records (employee_id, record_type, date, reason)
             VALUES (?, 'termination', ?, 'Baja del sistema')`,
            [req.params.id, new Date().toISOString().split('T')[0]]
        );

        res.json({ message: 'Trabajador dado de baja correctamente' });

    } catch (error) {
        console.error('Error al eliminar trabajador:', error);
        res.status(500).json({ error: 'Error al eliminar trabajador' });
    }
});

module.exports = router;
