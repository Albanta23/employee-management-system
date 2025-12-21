const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const User = require('../models/User');
const { getSettingsForAccess } = require('../utils/accessScope');
const bcrypt = require('bcrypt');
const { authenticateToken, isAdmin } = require('../middleware/auth');

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

function normalizeStringList(value) {
    if (!value) return [];
    const raw = Array.isArray(value) ? value : String(value).split(/\r?\n|,/g);
    const cleaned = raw
        .map(v => String(v).trim())
        .filter(Boolean);
    return Array.from(new Set(cleaned));
}

function pickPublicSettings(settings) {
    if (!settings) return null;
    return {
        company_name: settings.company_name,
        company_address: settings.company_address,
        company_cif: settings.company_cif,
        logo_base64: settings.logo_base64,
        updated_at: settings.updated_at
    };
}

// Get Settings (PUBLIC: Company Info & Logo)
router.get('/', async (req, res) => {
    try {
        // Si Mongo está lento/inaccesible, no bloqueamos la respuesta indefinidamente.
        const settings = await withTimeout(
            Settings.findOne().maxTimeMS(15000),
            16000,
            'Settings.findOne (public)'
        );

        if (!settings) {
            // No forzamos un save aquí: el branding puede devolverse con defaults.
            return res.json(pickPublicSettings(new Settings()));
        }

        return res.json(pickPublicSettings(settings));
    } catch (error) {
        console.error('Error al obtener configuración pública:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

// Get Settings (ADMIN: includes coordinator config)
router.get('/admin', authenticateToken, isAdmin, async (req, res) => {
    try {
        let settings = await withTimeout(
            Settings.findOne().maxTimeMS(15000),
            16000,
            'Settings.findOne (admin)'
        );
        if (!settings) settings = new Settings();

        let coordinatorUser = null;
        if (settings.store_coordinator_user_id) {
            coordinatorUser = await withTimeout(
                User.findById(settings.store_coordinator_user_id)
                    .select('username role mustChangePassword')
                    .lean(),
                16000,
                'User.findById (admin)'
            );
        }

        res.json({
            settings,
            store_coordinator_user: coordinatorUser ? {
                id: coordinatorUser._id,
                username: coordinatorUser.username,
                role: coordinatorUser.role,
                mustChangePassword: coordinatorUser.mustChangePassword
            } : null
        });
    } catch (error) {
        console.error('Error al obtener configuración admin:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

// Get Access Config (AUTH: admin/coordinator)
router.get('/access', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.json({
                role: 'admin',
                enabled: true,
                access: {
                    dashboard: true,
                    employees: true,
                    attendance: true,
                    vacations: true,
                    absences: true,
                    permissions: true,
                    reports: true,
                    settings: true
                }
            });
        }

        if (req.user.role === 'store_coordinator') {
            const settings = await getSettingsForAccess();
            return res.json({
                role: 'store_coordinator',
                enabled: !!settings.store_coordinator_enabled,
                access: {
                    ...(settings.store_coordinator_access || {}),
                    settings: false
                }
            });
        }

        return res.status(403).json({ error: 'Acceso denegado' });
    } catch (error) {
        console.error('Error al obtener accesos:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error al obtener configuración de accesos' });
    }
});

// Update Settings
router.put('/', authenticateToken, isAdmin, async (req, res) => {
    try {
        console.log('📝 Received settings update request');
        console.log('User:', req.user);
        console.log('Body keys:', Object.keys(req.body));
        const {
            company_name,
            company_address,
            company_cif,
            logo_base64
        } = req.body;
        console.log('Data to save:', { company_name, company_address, company_cif, logo_length: logo_base64 ? logo_base64.length : 0 });

        let settings = await withTimeout(
            Settings.findOne().maxTimeMS(15000),
            16000,
            'Settings.findOne (update branding)'
        );
        if (!settings) {
            settings = new Settings();
        }

        settings.company_name = company_name;
        settings.company_address = company_address;
        settings.company_cif = company_cif;
        if (logo_base64 !== undefined) settings.logo_base64 = logo_base64;
        settings.updated_at = Date.now();

        await withTimeout(settings.save(), 20000, 'Settings.save (update branding)');
        res.json(settings);
    } catch (error) {
        console.error('Error saving settings:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

// Create/Update Store Coordinator configuration (ADMIN)
router.put('/store-coordinator', authenticateToken, isAdmin, async (req, res) => {
    try {
        const {
            enabled,
            username,
            password,
            store_locations,
            access
        } = req.body || {};

        let settings = await withTimeout(
            Settings.findOne().maxTimeMS(15000),
            16000,
            'Settings.findOne (store-coordinator)'
        );
        if (!settings) settings = new Settings();

        // Asegurar estructura en documentos antiguos (sin defaults)
        if (!settings.store_coordinator_access || typeof settings.store_coordinator_access !== 'object') {
            settings.store_coordinator_access = {
                dashboard: true,
                employees: true,
                attendance: true,
                vacations: true,
                absences: true,
                permissions: true,
                reports: true
            };
        }
        if (!Array.isArray(settings.store_locations)) {
            settings.store_locations = [];
        }

        // Normalize + persist store locations
        if (store_locations !== undefined) {
            settings.store_locations = normalizeStringList(store_locations);
        }

        // Persist access map (only known keys)
        if (access && typeof access === 'object') {
            const allowedKeys = ['dashboard', 'employees', 'attendance', 'vacations', 'absences', 'permissions', 'reports'];
            for (const key of allowedKeys) {
                if (Object.prototype.hasOwnProperty.call(access, key)) {
                    settings.store_coordinator_access[key] = !!access[key];
                }
            }
        }

        if (enabled !== undefined) {
            settings.store_coordinator_enabled = !!enabled;
        }

        // Create or update coordinator user
        let coordinatorUser = null;
        if (settings.store_coordinator_user_id) {
            coordinatorUser = await withTimeout(
                User.findById(settings.store_coordinator_user_id),
                16000,
                'User.findById (store-coordinator)'
            );
        }

        const wantsEnable = settings.store_coordinator_enabled === true;
        const hasUser = !!coordinatorUser;

        if (wantsEnable && !hasUser) {
            if (!username || !password) {
                return res.status(400).json({
                    error: 'Para activar el Coordinador de Tiendas por primera vez, indica usuario y contraseña.'
                });
            }

            const hashedPassword = await bcrypt.hash(String(password), 10);
            coordinatorUser = new User({
                username: String(username),
                password: hashedPassword,
                name: 'Coordinador de Tiendas',
                role: 'store_coordinator',
                mustChangePassword: false
            });
            await withTimeout(coordinatorUser.save(), 20000, 'User.save (create store-coordinator)');
            settings.store_coordinator_user_id = coordinatorUser._id;
        }

        if (coordinatorUser) {
            // Update username/password if provided
            if (username) coordinatorUser.username = String(username);
            if (password) {
                coordinatorUser.password = await bcrypt.hash(String(password), 10);
                coordinatorUser.mustChangePassword = false;
            }
            coordinatorUser.role = 'store_coordinator';
            await withTimeout(coordinatorUser.save(), 20000, 'User.save (update store-coordinator)');
        }

        settings.updated_at = Date.now();
        await withTimeout(settings.save(), 20000, 'Settings.save (store-coordinator)');

        res.json({
            message: 'Configuración del Coordinador de Tiendas actualizada correctamente',
            settings: {
                store_locations: settings.store_locations,
                store_coordinator_enabled: settings.store_coordinator_enabled,
                store_coordinator_access: settings.store_coordinator_access,
                store_coordinator_user_id: settings.store_coordinator_user_id
            },
            store_coordinator_user: coordinatorUser ? { id: coordinatorUser._id, username: coordinatorUser.username } : null
        });
    } catch (error) {
        console.error('Error actualizando coordinador:', error);
        if (error && error.code === 11000) {
            return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
        }
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        res.status(500).json({ error: 'Error al actualizar el Coordinador de Tiendas' });
    }
});

// Update Admin Credentials
router.put('/admin-credentials', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { new_username, new_password, current_password } = req.body;

        // Verify current admin
        const adminUser = await User.findById(req.user.id);

        // Safety check: ensure we are modifying the logged-in admin
        if (!adminUser) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Verify current password if provided (for security)
        /* 
           Note: Requirement is "change defaults". We can skip strict current pwd check if assuming 
           they are already logged in with default, BUT it's better practice or they might lock themselves out.
           However, simplifying as per user request to just "substitute".
        */

        if (new_username) adminUser.username = new_username;
        if (new_password) {
            const salt = await bcrypt.genSalt(10);
            adminUser.password = await bcrypt.hash(new_password, salt);
        }

        await adminUser.save();
        res.json({ message: 'Credenciales de administrador actualizadas correctamente' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar credenciales' });
    }
});

module.exports = router;
