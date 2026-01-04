const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const { authenticateToken } = require('../middleware/auth');
require('dotenv').config();

function getJwtSecret() {
    return process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || process.env.JWT_KEY;
}

function normalizeDni(value) {
    return String(value || '').trim().toUpperCase();
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findActiveStoreByName(storeNameRaw) {
    const storeName = String(storeNameRaw || '').trim();
    if (!storeName) return null;
    const rx = new RegExp(`^${escapeRegExp(storeName)}$`, 'i');

    const location = await withTimeout(
        Location.findOne({ active: true, 'stores.name': rx }).maxTimeMS(5000),
        5500,
        'Location.findOne (store login)'
    );

    if (!location) return null;
    const store = (location.stores || []).find(s => s && rx.test(String(s.name || '')));
    if (!store) return null;
    if (store.active === false) return null;

    return {
        storeName: String(store.name || '').trim(),
        clockPinHash: String(store.clock_pin_hash || '').trim()
    };
}

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`Timeout (${ms}ms)${label ? `: ${label}` : ''}`);
            err.code = 'ETIMEDOUT';
            reject(err);
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Middleware para verificar el token de cambio de contraseña
const verifyChangeToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Token de autorización requerido' });
    }

    const secret = getJwtSecret();
    if (!secret) {
        return res.status(500).json({
            error: 'Configuración del servidor incompleta (JWT_SECRET)',
            code: 'SERVER_MISCONFIG'
        });
    }

    jwt.verify(token, secret, (err, decoded) => {
        // Verificamos que el token sea específicamente para cambiar contraseña
        if (err || decoded.purpose !== 'change-password') {
            return res.status(403).json({ error: 'Token inválido o no autorizado para esta acción' });
        }
        req.user = decoded; // Adjuntamos el payload decodificado (que tiene el id del usuario)
        next();
    });
};


// Login
router.post('/login', async (req, res) => {
    try {
        const secret = getJwtSecret();
        if (!secret) {
            return res.status(500).json({
                error: 'Configuración del servidor incompleta (JWT_SECRET)',
                code: 'SERVER_MISCONFIG'
            });
        }

        // El frontend enviará el DNI como 'username' y el teléfono/código como 'password'
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'DNI y Teléfono/Código requeridos' });
        }

        const user = await withTimeout(
            User.findOne({ username }).maxTimeMS(5000),
            5500,
            'User.findOne (login)'
        );

        // Si NO existe usuario, intentamos login como TIENDA (portal tablet)
        if (!user) {
            const store = await findActiveStoreByName(username);
            if (!store || !store.clockPinHash) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const ok = await bcrypt.compare(String(password), store.clockPinHash);
            if (!ok) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const token = jwt.sign(
                {
                    id: `store:${store.storeName}`,
                    username: store.storeName,
                    role: 'store_clock',
                    storeName: store.storeName
                },
                secret,
                { expiresIn: '24h' }
            );

            return res.json({
                token,
                user: {
                    id: `store:${store.storeName}`,
                    username: store.storeName,
                    name: store.storeName,
                    role: 'store_clock',
                    storeName: store.storeName
                }
            });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Si el usuario debe cambiar su contraseña
        if (user.mustChangePassword) {
            // Generamos un token temporal con un propósito específico y corta duración
            const changeToken = jwt.sign(
                { id: user._id, purpose: 'change-password' },
                secret,
                { expiresIn: '15m' } // El usuario tiene 15 mins para cambiar la clave
            );
            return res.json({
                forceChange: true,
                changeToken: changeToken,
                message: 'Por favor, cambia tu código de acceso.'
            });
        }

        // Auto-vincular employee_id por DNI si falta (caso típico tras migraciones/seeds)
        let resolvedEmployeeId = user.employee_id;
        let resolvedEmployeeLocation = null;
        if (user.role === 'employee' && !resolvedEmployeeId) {
            const dni = normalizeDni(username);
            const employee = await withTimeout(
                Employee.findOne({ dni }).select('_id location').lean().maxTimeMS(5000),
                5500,
                'Employee.findOne (login auto-link)'
            );

            if (employee && employee._id) {
                resolvedEmployeeId = employee._id;
                resolvedEmployeeLocation = employee.location || null;
                // Persistimos el vínculo para futuras sesiones
                user.employee_id = employee._id;
                await withTimeout(user.save(), 5500, 'User.save (login auto-link)');
            }
        }

        // Si no, procedemos con el login normal
        const token = jwt.sign(
            {
                id: user._id,
                username: user.username,
                role: user.role || 'admin',
                employee_id: resolvedEmployeeId
            },
            secret,
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
                employee_id: resolvedEmployeeId,
                // Útil para el portal empleado (cálculo de días / UI)
                location: resolvedEmployeeLocation
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Endpoint para forzar el cambio de contraseña
router.post('/change-password', verifyChangeToken, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ error: 'El nuevo código debe tener al menos 4 caracteres.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        const userId = req.user.id;
        await withTimeout(
            User.findByIdAndUpdate(userId, {
                password: hashedPassword,
                mustChangePassword: false
            }).maxTimeMS(5000),
            5500,
            'User.findByIdAndUpdate (change-password)'
        );

        res.json({ success: true, message: 'Código de acceso actualizado correctamente. Por favor, inicia sesión de nuevo.' });

    } catch (error) {
        console.error('Error en change-password:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error en el servidor al cambiar la contraseña.' });
    }
});

// Validar sesión actual (token) y devolver el usuario
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user && (req.user.id || req.user._id) ? String(req.user.id || req.user._id) : null;
        if (!userId) {
            return res.status(401).json({ error: 'Token inválido' });
        }

        const dbUser = await withTimeout(
            User.findById(userId).select('username name email role employee_id mustChangePassword').maxTimeMS(5000),
            5500,
            'User.findById (me)'
        );

        if (!dbUser) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        // Si por alguna razón vuelve a requerir cambio de contraseña, forzamos re-login normal
        if (dbUser.mustChangePassword) {
            return res.status(403).json({ error: 'Se requiere cambiar el código de acceso' });
        }

        res.json({
            user: {
                id: dbUser._id,
                username: dbUser.username,
                name: dbUser.name,
                email: dbUser.email,
                role: dbUser.role || 'admin',
                employee_id: dbUser.employee_id || null
            }
        });
    } catch (error) {
        console.error('Error en /me:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error en el servidor' });
    }
});


// --- Rutas anteriores ---

// Obtener acceso de un empleado (para el admin)
router.get('/user-access/:employee_id', async (req, res) => {
    try {
        // Este endpoint debería estar protegido también, pero lo dejamos como estaba
        const user = await withTimeout(
            User.findOne({ employee_id: req.params.employee_id })
                .select('username role')
                .maxTimeMS(5000),
            5500,
            'User.findOne (user-access)'
        );
        res.json(user || {});
    } catch (error) {
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error al obtener acceso' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    res.json({ message: 'Sesión cerrada correctamente' });
});

module.exports = router;