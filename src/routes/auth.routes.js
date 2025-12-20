const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }

        // Buscar usuario en MongoDB
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Generar token
        const token = jwt.sign(
            {
                id: user._id,
                username: user.username,
                role: user.role || 'admin',
                employee_id: user.employee_id
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                name: user.name,
                email: user.email,
                role: user.role || 'admin',
                employee_id: user.employee_id
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Obtener acceso de un empleado (para el admin)
router.get('/user-access/:employee_id', async (req, res) => {
    try {
        const user = await User.findOne({ employee_id: req.params.employee_id }).select('username role');
        res.json(user || {});
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener acceso' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    res.json({ message: 'Sesión cerrada correctamente' });
});

module.exports = router;
