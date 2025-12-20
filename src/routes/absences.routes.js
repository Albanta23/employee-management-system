const express = require('express');
const router = express.Router();
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Obtener todas las bajas
router.get('/', async (req, res) => {
    try {
        const { employee_id, status, type } = req.query;
        const query = {};

        if (employee_id) query.employee_id = employee_id;
        if (status) query.status = status;
        if (type) query.type = type;

        const absences = await Absence.find(query)
            .populate('employee_id', 'full_name dni position location')
            .sort({ start_date: -1 })
            .lean()
            .exec();

        const formatted = absences.map(a => ({
            ...a,
            id: a._id.toString(),
            _id: a._id.toString(),
            full_name: a.employee_id?.full_name,
            dni: a.employee_id?.dni,
            position: a.employee_id?.position,
            location: a.employee_id?.location,
            employee_id: a.employee_id?._id.toString()
        }));

        res.json(formatted);

    } catch (error) {
        console.error('Error al obtener bajas:', error);
        res.status(500).json({ error: 'Error al obtener bajas' });
    }
});

// Registrar una baja
router.post('/', async (req, res) => {
    try {
        const { employee_id, start_date, end_date, type, reason, medical_certificate, notes } = req.body;

        if (!employee_id || !start_date || !type) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const absence = new Absence({
            employee_id, start_date, end_date, type, reason, medical_certificate, notes, status: 'active'
        });

        await absence.save();

        // Si es una baja activa, actualizar el estado del empleado opcionalmente
        // await Employee.findByIdAndUpdate(employee_id, { status: 'on_leave' });

        res.status(201).json({ id: absence._id, message: 'Baja registrada correctamente' });

    } catch (error) {
        console.error('Error al registrar baja:', error);
        res.status(500).json({ error: 'Error al registrar baja' });
    }
});

// Finalizar una baja
router.put('/:id/close', async (req, res) => {
    try {
        const { end_date } = req.body;
        const absence = await Absence.findByIdAndUpdate(req.params.id, {
            status: 'closed',
            end_date: end_date || new Date()
        }, { new: true });

        if (!absence) return res.status(404).json({ error: 'Baja no encontrada' });
        res.json({ message: 'Baja finalizada correctamente' });

    } catch (error) {
        res.status(500).json({ error: 'Error al finalizar baja' });
    }
});

// Eliminar registro
router.delete('/:id', async (req, res) => {
    try {
        await Absence.findByIdAndDelete(req.params.id);
        res.json({ message: 'Registro eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar baja' });
    }
});

module.exports = router;
