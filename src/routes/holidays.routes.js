const express = require('express');
const router = express.Router();
const Holiday = require('../models/Holiday');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Obtener todos los festivos
router.get('/', async (req, res) => {
    try {
        const holidays = await Holiday.find().sort({ date: 1 });
        res.json(holidays);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener festivos' });
    }
});

// Crear festivo
router.post('/', async (req, res) => {
    try {
        const { date, name, type, location } = req.body;
        const holiday = new Holiday({ date, name, type, location });
        await holiday.save();
        res.status(201).json(holiday);
    } catch (error) {
        res.status(500).json({ error: 'Error al crear festivo' });
    }
});

// Eliminar festivo
router.delete('/:id', async (req, res) => {
    try {
        await Holiday.findByIdAndDelete(req.params.id);
        res.json({ message: 'Festivo eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar festivo' });
    }
});

const { calculateVacationDays } = require('../utils/dateUtils');

// Calcular días entre fechas (laborables/naturales según convenio)
router.get('/calculate', async (req, res) => {
    try {
        const { start_date, end_date, location } = req.query;
        if (!start_date || !end_date) return res.status(400).json({ error: 'Faltan fechas' });

        const days = await calculateVacationDays(new Date(start_date), new Date(end_date), location || '');
        res.json({ days });
    } catch (error) {
        res.status(500).json({ error: 'Error en el cálculo' });
    }
});

module.exports = router;
