const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Obtener todas las bajas
router.get('/', async (req, res) => {
    try {
        const { employee_id, status, type } = req.query;

        let query = `
            SELECT a.*, e.full_name, e.dni, e.position, e.location 
            FROM absences a
            JOIN employees e ON a.employee_id = e.id
            WHERE 1=1
        `;
        const params = [];

        if (employee_id) {
            query += ' AND a.employee_id = ?';
            params.push(employee_id);
        }

        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        }

        if (type) {
            query += ' AND a.type = ?';
            params.push(type);
        }

        query += ' ORDER BY a.start_date DESC';

        const absences = await dbAll(query, params);
        res.json(absences);

    } catch (error) {
        console.error('Error al obtener bajas:', error);
        res.status(500).json({ error: 'Error al obtener bajas' });
    }
});

// Crear nueva baja
router.post('/', async (req, res) => {
    try {
        const { employee_id, start_date, end_date, type, reason, medical_certificate, notes } = req.body;

        if (!employee_id || !start_date || !type) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const result = await dbRun(
            `INSERT INTO absences (employee_id, start_date, end_date, type, reason, medical_certificate, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
            [employee_id, start_date, end_date || null, type, reason || null, medical_certificate ? 1 : 0, notes || null]
        );

        // Actualizar estado del empleado si la baja es activa
        await dbRun(
            `UPDATE employees SET status = 'on_leave' WHERE id = ?`,
            [employee_id]
        );

        res.status(201).json({ id: result.id, message: 'Baja registrada correctamente' });

    } catch (error) {
        console.error('Error al crear baja:', error);
        res.status(500).json({ error: 'Error al crear baja' });
    }
});

// Actualizar baja (cerrar, modificar fechas, etc)
router.put('/:id', async (req, res) => {
    try {
        const { end_date, status, notes, type, reason, medical_certificate } = req.body;

        const absence = await dbGet('SELECT * FROM absences WHERE id = ?', [req.params.id]);

        if (!absence) {
            return res.status(404).json({ error: 'Baja no encontrada' });
        }

        await dbRun(
            `UPDATE absences 
             SET end_date = ?, status = ?, notes = ?, type = ?, reason = ?, medical_certificate = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                end_date || absence.end_date,
                status || absence.status,
                notes || absence.notes,
                type || absence.type,
                reason || absence.reason,
                medical_certificate !== undefined ? (medical_certificate ? 1 : 0) : absence.medical_certificate,
                req.params.id
            ]
        );

        // Si se cierra la baja, reactivar al empleado si no tiene otras bajas activas
        if (status === 'closed') {
            const activeAbsences = await dbGet(
                'SELECT COUNT(*) as count FROM absences WHERE employee_id = ? AND status = "active" AND id != ?',
                [absence.employee_id, req.params.id]
            );

            if (activeAbsences.count === 0) {
                await dbRun(
                    `UPDATE employees SET status = 'active' WHERE id = ?`,
                    [absence.employee_id]
                );
            }
        }

        res.json({ message: 'Baja actualizada correctamente' });

    } catch (error) {
        console.error('Error al actualizar baja:', error);
        res.status(500).json({ error: 'Error al actualizar baja' });
    }
});

// Eliminar baja
router.delete('/:id', async (req, res) => {
    try {
        const absence = await dbGet('SELECT * FROM absences WHERE id = ?', [req.params.id]);

        if (!absence) {
            return res.status(404).json({ error: 'Baja no encontrada' });
        }

        await dbRun('DELETE FROM absences WHERE id = ?', [req.params.id]);

        // Verificar si quedan bajas activas para este empleado
        const activeAbsences = await dbGet(
            'SELECT COUNT(*) as count FROM absences WHERE employee_id = ? AND status = "active"',
            [absence.employee_id]
        );

        if (activeAbsences.count === 0) {
            await dbRun(
                `UPDATE employees SET status = 'active' WHERE id = ?`,
                [absence.employee_id]
            );
        }

        res.json({ message: 'Baja eliminada correctamente' });

    } catch (error) {
        console.error('Error al eliminar baja:', error);
        res.status(500).json({ error: 'Error al eliminar baja' });
    }
});

module.exports = router;
