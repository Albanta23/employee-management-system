const express = require('express');
const router = express.Router();
const Vacation = require('../models/Vacation');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Obtener todas las vacaciones con filtros
router.get('/', async (req, res) => {
    try {
        const { employee_id, status, year, type } = req.query;
        const query = {};

        if (employee_id) query.employee_id = employee_id;
        if (status) query.status = status;
        if (type) query.type = type;
        if (year) {
            query.start_date = {
                $gte: new Date(`${year}-01-01`),
                $lte: new Date(`${year}-12-31`)
            };
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
        const { employee_id, start_date, end_date, type, reason } = req.body;

        if (!employee_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const employee = await Employee.findById(employee_id);
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

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

// Actualizar estado de vacación (Aprobar/Rechazar)
router.put('/:id', async (req, res) => {
    try {
        const { status, reason } = req.body;

        const update = { status };
        if (status === 'approved') {
            update.approved_by = req.user.id;
            update.approved_date = new Date();
        }
        if (reason) update.reason = reason;

        const vacation = await Vacation.findByIdAndUpdate(req.params.id, update, { new: true });

        if (!vacation) return res.status(404).json({ error: 'Solicitud no encontrada' });
        res.json({ message: 'Solicitud actualizada correctamente' });

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
        await Vacation.findByIdAndDelete(req.params.id);
        res.json({ message: 'Solicitud eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar solicitud' });
    }
});

module.exports = router;
