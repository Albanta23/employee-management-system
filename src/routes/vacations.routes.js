const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Obtener todas las vacaciones con filtros
router.get('/', async (req, res) => {
    try {
        const { employee_id, status, year } = req.query;

        let query = `
            SELECT v.*, e.full_name, e.position, e.location 
            FROM vacations v
            JOIN employees e ON v.employee_id = e.id
            WHERE 1=1
        `;
        const params = [];

        if (employee_id) {
            query += ' AND v.employee_id = ?';
            params.push(employee_id);
        }

        if (status) {
            query += ' AND v.status = ?';
            params.push(status);
        }

        if (year) {
            query += ' AND strftime("%Y", v.start_date) = ?';
            params.push(year);
        }

        query += ' ORDER BY v.start_date DESC';

        const vacations = await dbAll(query, params);
        res.json(vacations);

    } catch (error) {
        console.error('Error al obtener vacaciones:', error);
        res.status(500).json({ error: 'Error al obtener vacaciones' });
    }
});

// Obtener calendario de vacaciones (para vista mensual/anual)
router.get('/calendar', async (req, res) => {
    try {
        const { year = new Date().getFullYear(), month } = req.query;

        let query = `
            SELECT v.*, e.full_name, e.position, e.location 
            FROM vacations v
            JOIN employees e ON v.employee_id = e.id
            WHERE v.status = 'approved' AND strftime("%Y", v.start_date) = ?
        `;
        const params = [year.toString()];

        if (month) {
            query += ' AND strftime("%m", v.start_date) = ?';
            params.push(month.toString().padStart(2, '0'));
        }

        query += ' ORDER BY v.start_date ASC';

        const vacations = await dbAll(query, params);
        res.json(vacations);

    } catch (error) {
        console.error('Error al obtener calendario:', error);
        res.status(500).json({ error: 'Error al obtener calendario' });
    }
});

// Crear solicitud de vacaciones
router.post('/', async (req, res) => {
    try {
        const { employee_id, start_date, end_date, days, type, reason } = req.body;

        if (!employee_id || !start_date || !end_date || !days) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const result = await dbRun(
            `INSERT INTO vacations (employee_id, start_date, end_date, days, type, reason, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [employee_id, start_date, end_date, days, type || 'vacation', reason || null]
        );

        res.status(201).json({ id: result.id, message: 'Solicitud de vacaciones creada' });

    } catch (error) {
        console.error('Error al crear solicitud:', error);
        res.status(500).json({ error: 'Error al crear solicitud' });
    }
});

// Actualizar estado de vacaciones (aprobar/rechazar)
router.put('/:id', async (req, res) => {
    try {
        const { status, reason } = req.body;

        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }

        const result = await dbRun(
            `UPDATE vacations 
             SET status = ?, reason = ?, approved_by = ?, approved_date = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [status, reason || null, req.user.id, req.params.id]
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        res.json({ message: 'Solicitud actualizada correctamente' });

    } catch (error) {
        console.error('Error al actualizar solicitud:', error);
        res.status(500).json({ error: 'Error al actualizar solicitud' });
    }
});

// Eliminar solicitud de vacaciones
router.delete('/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM vacations WHERE id = ?', [req.params.id]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        res.json({ message: 'Solicitud eliminada correctamente' });

    } catch (error) {
        console.error('Error al eliminar solicitud:', error);
        res.status(500).json({ error: 'Error al eliminar solicitud' });
    }
});

module.exports = router;
