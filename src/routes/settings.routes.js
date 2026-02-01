const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const User = require('../models/User');
const { getSettingsForAccess, requireFeatureAccess } = require('../utils/accessScope');
const Employee = require('../models/Employee');
const bcrypt = require('bcrypt');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { logAudit, pick, shallowDiff } = require('../utils/audit');
const { runVacationRollover } = require('../utils/vacationRollover');

function buildDefaultOverlapRules() {
    return {
        vacation: { vacation: true, permission: true, absence: true },
        permission: { vacation: true, permission: true, absence: true },
        absence: { vacation: true, permission: true, absence: true }
    };
}

function buildDefaultVacationPolicy() {
    return {
        proration_enabled: false,
        proration_rounding_increment: 0.5,
        carryover_enabled: false,
        carryover_max_days: 0,
        carryover_expiry_month_day: '03-31'
    };
}

function normalizeVacationPolicy(input) {
    const out = buildDefaultVacationPolicy();
    if (!input || typeof input !== 'object') return out;

    if (Object.prototype.hasOwnProperty.call(input, 'proration_enabled')) {
        out.proration_enabled = !!input.proration_enabled;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'proration_rounding_increment')) {
        const inc = Number(input.proration_rounding_increment);
        out.proration_rounding_increment = (Number.isFinite(inc) && inc > 0) ? inc : out.proration_rounding_increment;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'carryover_enabled')) {
        out.carryover_enabled = !!input.carryover_enabled;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'carryover_max_days')) {
        const max = Number(input.carryover_max_days);
        out.carryover_max_days = (Number.isFinite(max) && max >= 0) ? max : out.carryover_max_days;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'carryover_expiry_month_day')) {
        const md = String(input.carryover_expiry_month_day || '').trim();
        if (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(md)) {
            out.carryover_expiry_month_day = md;
        }
    }

    return out;
}

function normalizeOverlapRules(input) {
    const defaults = buildDefaultOverlapRules();
    if (!input || typeof input !== 'object') return defaults;

    const out = buildDefaultOverlapRules();
    for (const fromKey of ['vacation', 'permission', 'absence']) {
        const row = input[fromKey];
        if (!row || typeof row !== 'object') continue;
        for (const toKey of ['vacation', 'permission', 'absence']) {
            if (Object.prototype.hasOwnProperty.call(row, toKey)) {
                out[fromKey][toKey] = !!row[toKey];
            }
        }
    }
    return out;
}

function getLocationOverride(settings, locationKey) {
    if (!settings || !locationKey) return null;
    const key = String(locationKey || '').trim();
    if (!key) return null;

    const raw = settings.overlap_rules_by_location;
    if (!raw) return null;

    // Con lean() puede venir como objeto plano; con documento puede ser Map.
    if (raw instanceof Map) {
        return raw.get(key) || null;
    }

    if (typeof raw === 'object') {
        return raw[key] || null;
    }

    return null;
}

function setLocationOverride(settings, locationKey, rules) {
    const key = String(locationKey || '').trim();
    if (!key) return false;

    if (!settings.overlap_rules_by_location) {
        settings.overlap_rules_by_location = new Map();
    }

    // Documento: Map
    if (settings.overlap_rules_by_location instanceof Map) {
        settings.overlap_rules_by_location.set(key, rules);
        return true;
    }

    // Por si Mongoose lo materializa como objeto
    settings.overlap_rules_by_location[key] = rules;
    return true;
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
        regularization_admin_pin: settings.regularization_admin_pin,
        regularization_coordinator_pin: settings.regularization_coordinator_pin,
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
                    settings: !!(settings.store_coordinator_access && settings.store_coordinator_access.settings)
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

// Get/Update Overlap Rules (ADMIN or store_coordinator with settings access)
router.get('/overlap-rules/targets', authenticateToken, async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'settings');
        if (!hasAccess) return;

        if (req.user.role === 'store_coordinator') {
            const settings = await getSettingsForAccess();
            if (!settings.store_coordinator_enabled) {
                return res.status(403).json({ error: 'Perfil de Coordinador desactivado' });
            }

            // Scope del coordinador: lista de tiendas/ubicaciones permitidas (Employee.location)
            const storeLocations = Array.isArray(settings.store_locations) ? settings.store_locations : [];
            // Si no hay lista configurada, el accessScope deriva tiendas a partir de empleados; aquí
            // evitamos duplicar lógica: devolvemos el array configurado y, si está vacío, devolvemos el distinct.
            const cleaned = storeLocations.map(s => String(s || '').trim()).filter(Boolean);
            if (cleaned.length > 0) {
                return res.json({ targets: Array.from(new Set(cleaned)).sort() });
            }

            const distinct = await Employee.distinct('location', {
                location: { $exists: true, $ne: null, $ne: '' }
            }).maxTimeMS(15000);

            // Si el admin no configuró tiendas, el coordinador “tienda vs fábrica” se decide en accessScope.
            // Para no inventar aquí, devolvemos el distinct; el coordinador solo podrá GUARDAR para ubicaciones
            // que el backend valide como permitidas (en PUT).
            return res.json({ targets: (distinct || []).map(s => String(s).trim()).filter(Boolean).sort() });
        }

        // Admin: todas las ubicaciones existentes en empleados
        const distinct = await Employee.distinct('location', {
            location: { $exists: true, $ne: null, $ne: '' }
        }).maxTimeMS(15000);

        return res.json({ targets: (distinct || []).map(s => String(s).trim()).filter(Boolean).sort() });
    } catch (error) {
        console.error('Error al obtener targets de reglas de solapamiento:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        return res.status(500).json({ error: 'Error al obtener ubicaciones disponibles' });
    }
});

router.get('/overlap-rules', authenticateToken, async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'settings');
        if (!hasAccess) return;

        const location = req.query && req.query.location ? String(req.query.location).trim() : '';

        let settings = await withTimeout(
            Settings.findOne().maxTimeMS(15000),
            16000,
            'Settings.findOne (overlap-rules get)'
        );
        if (!settings) settings = new Settings();

        const globalRules = normalizeOverlapRules(settings.overlap_rules);
        const locationRulesRaw = location ? getLocationOverride(settings, location) : null;
        const locationRules = location ? normalizeOverlapRules(locationRulesRaw) : null;

        return res.json({
            location: location || null,
            is_override: !!(location && locationRulesRaw),
            overlap_rules: location ? (locationRules || globalRules) : globalRules,
            updated_at: settings.updated_at
        });
    } catch (error) {
        console.error('Error al obtener reglas de solapamiento:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        return res.status(500).json({ error: 'Error al obtener reglas de solapamiento' });
    }
});

router.put('/overlap-rules', authenticateToken, async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'settings');
        if (!hasAccess) return;

        const location = req.body && typeof req.body === 'object' && req.body.location != null
            ? String(req.body.location).trim()
            : '';

        const incoming = req.body && typeof req.body === 'object' ? req.body.overlap_rules : null;
        const normalized = normalizeOverlapRules(incoming);

        // Coordinador: solo puede definir reglas para ubicaciones de su scope
        if (req.user.role === 'store_coordinator' && location) {
            const settingsAccess = await getSettingsForAccess();
            if (!settingsAccess.store_coordinator_enabled) {
                return res.status(403).json({ error: 'Perfil de Coordinador desactivado' });
            }

            const configured = Array.isArray(settingsAccess.store_locations) ? settingsAccess.store_locations : [];
            const allowed = new Set(configured.map(s => String(s || '').trim()).filter(Boolean));

            // Si no hay lista configurada, seguimos permitiendo guardar, pero solo si existe una ubicación real en empleados.
            if (allowed.size > 0) {
                if (!allowed.has(location)) {
                    return res.status(403).json({ error: 'No tienes permiso para configurar esta ubicación' });
                }
            } else {
                const exists = await Employee.exists({ location }).maxTimeMS(15000);
                if (!exists) {
                    return res.status(400).json({ error: 'Ubicación no válida' });
                }
            }
        }

        let settings = await withTimeout(
            Settings.findOne().maxTimeMS(15000),
            16000,
            'Settings.findOne (overlap-rules put)'
        );
        if (!settings) settings = new Settings();

        const before = {
            location: location || null,
            overlap_rules: location ? getLocationOverride(settings, location) : settings.overlap_rules
        };

        if (location) {
            setLocationOverride(settings, location, normalized);
        } else {
            settings.overlap_rules = normalized;
        }
        settings.updated_at = Date.now();

        await withTimeout(settings.save(), 20000, 'Settings.save (overlap-rules put)');

        const after = {
            location: location || null,
            overlap_rules: normalized
        };

        await logAudit({
            req,
            action: 'settings.overlap_rules.update',
            entityType: 'Settings',
            entityId: settings && settings._id ? String(settings._id) : 'singleton',
            employeeId: '',
            employeeLocation: '',
            before,
            after,
            meta: { changed: shallowDiff(before, after) }
        });

        return res.json({
            location: location || null,
            overlap_rules: normalized,
            updated_at: settings.updated_at
        });
    } catch (error) {
        console.error('Error al guardar reglas de solapamiento:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        return res.status(500).json({ error: 'Error al actualizar reglas de solapamiento' });
    }
});

// Get/Update Vacation Policy (ADMIN or store_coordinator with settings access)
router.get('/vacation-policy', authenticateToken, async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'settings');
        if (!hasAccess) return;

        const settings = await getSettingsForAccess();
        const policy = normalizeVacationPolicy(settings && settings.vacation_policy ? settings.vacation_policy : null);

        return res.json({ vacation_policy: policy, updated_at: settings && settings.updated_at ? settings.updated_at : null });
    } catch (error) {
        console.error('Error al obtener política de vacaciones:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        return res.status(500).json({ error: 'Error al obtener política de vacaciones' });
    }
});

router.put('/vacation-policy', authenticateToken, async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'settings');
        if (!hasAccess) return;

        if (req.user.role === 'store_coordinator') {
            const settingsAccess = await getSettingsForAccess();
            if (!settingsAccess.store_coordinator_enabled) {
                return res.status(403).json({ error: 'Perfil de Coordinador desactivado' });
            }
        }

        const normalized = normalizeVacationPolicy(req.body && req.body.vacation_policy ? req.body.vacation_policy : req.body);

        let settings = await withTimeout(
            Settings.findOne().maxTimeMS(15000),
            16000,
            'Settings.findOne (vacation-policy put)'
        );
        if (!settings) settings = new Settings();

        const before = pick(settings.toObject ? settings.toObject() : settings, ['vacation_policy']);

        settings.vacation_policy = normalized;
        settings.updated_at = Date.now();

        await withTimeout(settings.save(), 20000, 'Settings.save (vacation-policy put)');

        const after = { vacation_policy: normalized };
        await logAudit({
            req,
            action: 'settings.vacation_policy.update',
            entityType: 'Settings',
            entityId: settings && settings._id ? String(settings._id) : 'singleton',
            employeeId: '',
            employeeLocation: '',
            before,
            after,
            meta: { changed: shallowDiff(before, after) }
        });

        return res.json({ vacation_policy: normalized, updated_at: settings.updated_at });
    } catch (error) {
        console.error('Error al guardar política de vacaciones:', error);
        if (error && error.code === 'ETIMEDOUT') {
            return res.status(503).json({ error: 'La base de datos no responde (timeout)' });
        }
        return res.status(500).json({ error: 'Error al actualizar política de vacaciones' });
    }
});

// Ejecutar rollover de vacaciones manualmente (ADMIN)
// - En Vercel/serverless no hay cron persistente, así que se lanza bajo demanda.
router.post('/vacation-rollover', authenticateToken, isAdmin, async (req, res) => {
    try {
        const now = new Date();
        const defaultYear = now.getFullYear() - 1;

        const body = req.body || {};
        const targetYear = Number.isFinite(Number(body.year)) ? Number(body.year) : defaultYear;
        const dryRun = String(body.dryRun || 'false').toLowerCase() === 'true' || body.dryRun === true;
        const force = String(body.force || 'false').toLowerCase() === 'true' || body.force === true;

        const actor = {
            user_id: req.user && (req.user.id || req.user._id) ? String(req.user.id || req.user._id) : null,
            username: req.user && req.user.username ? String(req.user.username) : 'admin',
            role: req.user && req.user.role ? String(req.user.role) : 'admin'
        };

        const result = await runVacationRollover({ targetYear, dryRun, force, actor });

        await logAudit({
            req,
            action: 'settings.vacation_rollover.run',
            entityType: 'Settings',
            entityId: 'singleton',
            employeeId: '',
            employeeLocation: '',
            before: null,
            after: null,
            meta: {
                year: targetYear,
                dryRun,
                force,
                result
            }
        });

        return res.json(result);
    } catch (error) {
        console.error('Error al ejecutar rollover de vacaciones:', error);
        return res.status(500).json({ error: 'Error al ejecutar el rollover de vacaciones' });
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
            logo_base64,
            regularization_admin_pin,
            regularization_coordinator_pin
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

        const before = pick(settings.toObject ? settings.toObject() : settings, ['company_name', 'company_address', 'company_cif', 'logo_base64', 'regularization_admin_pin', 'regularization_coordinator_pin']);

        settings.company_name = company_name;
        settings.company_address = company_address;
        settings.company_cif = company_cif;
        if (logo_base64 !== undefined) settings.logo_base64 = logo_base64;
        if (regularization_admin_pin !== undefined) settings.regularization_admin_pin = regularization_admin_pin;
        if (regularization_coordinator_pin !== undefined) settings.regularization_coordinator_pin = regularization_coordinator_pin;
        settings.updated_at = Date.now();

        await withTimeout(settings.save(), 20000, 'Settings.save (update branding)');

        const after = pick(settings.toObject ? settings.toObject() : settings, ['company_name', 'company_address', 'company_cif', 'logo_base64', 'regularization_admin_pin', 'regularization_coordinator_pin']);
        await logAudit({
            req,
            action: 'settings.branding.update',
            entityType: 'Settings',
            entityId: settings && settings._id ? String(settings._id) : 'singleton',
            employeeId: '',
            employeeLocation: '',
            before,
            after,
            meta: { changed: shallowDiff(before, after), logo_changed: before.logo_base64 !== after.logo_base64 }
        });

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

        const before = pick(settings.toObject ? settings.toObject() : settings, ['store_locations', 'store_coordinator_enabled', 'store_coordinator_user_id', 'store_coordinator_access']);

        // Asegurar estructura en documentos antiguos (sin defaults)
        if (!settings.store_coordinator_access || typeof settings.store_coordinator_access !== 'object') {
            settings.store_coordinator_access = {
                dashboard: true,
                employees: true,
                attendance: true,
                vacations: true,
                absences: true,
                permissions: true,
                reports: true,
                locations: true,
                settings: false
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
            const allowedKeys = ['dashboard', 'employees', 'attendance', 'vacations', 'absences', 'permissions', 'reports', 'locations', 'settings'];
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

        const after = pick(settings.toObject ? settings.toObject() : settings, ['store_locations', 'store_coordinator_enabled', 'store_coordinator_user_id', 'store_coordinator_access']);
        await logAudit({
            req,
            action: 'settings.store_coordinator.update',
            entityType: 'Settings',
            entityId: settings && settings._id ? String(settings._id) : 'singleton',
            employeeId: '',
            employeeLocation: '',
            before,
            after,
            meta: {
                changed: shallowDiff(before, after),
                username_changed: !!username,
                password_changed: !!password
            }
        });

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

        const before = { username: adminUser.username };

        if (new_username) adminUser.username = new_username;
        if (new_password) {
            const salt = await bcrypt.genSalt(10);
            adminUser.password = await bcrypt.hash(new_password, salt);
        }

        await adminUser.save();

        const after = { username: adminUser.username };
        await logAudit({
            req,
            action: 'settings.admin_credentials.update',
            entityType: 'User',
            entityId: String(adminUser._id),
            employeeId: '',
            employeeLocation: '',
            before,
            after,
            meta: { username_changed: !!new_username, password_changed: !!new_password }
        });
        res.json({ message: 'Credenciales de administrador actualizadas correctamente' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar credenciales' });
    }
});

// =====================================================
// HERRAMIENTAS DE MANTENIMIENTO
// =====================================================

const Vacation = require('../models/Vacation');

/**
 * POST /api/settings/maintenance/fix-vacation-allocation
 * Corrige el allocation FIFO de solicitudes de vacaciones antiguas
 * que no tienen el campo allocation correctamente populado.
 * Solo admin puede ejecutar esta acción.
 */
router.post('/maintenance/fix-vacation-allocation', authenticateToken, async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
        }

        const dryRun = req.body.dry_run === true;
        const results = {
            dry_run: dryRun,
            employees_processed: 0,
            vacations_fixed: 0,
            vacations_already_valid: 0,
            details: []
        };

        // Obtener todos los empleados activos
        const employees = await Employee.find({ status: { $ne: 'inactive' } }).lean();

        for (const emp of employees) {
            // Obtener todas las vacaciones del empleado ordenadas por fecha de creación
            const vacations = await Vacation.find({
                employee_id: emp._id,
                type: 'vacation',
                status: { $in: ['approved', 'pending'] }
            }).sort({ created_at: 1 }).lean();

            if (vacations.length === 0) continue;

            results.employees_processed++;

            // El carryover TOTAL disponible para el empleado:
            // Es vacation_carryover_days (lo que tiene ahora sin usar)
            // MÁS lo que ya ha consumido SOLO en solicitudes APROBADAS
            // (las PENDIENTES aún no se han descontado del empleado, y su allocation puede estar mal)
            let carryoverUsedInApproved = 0;
            for (const v of vacations) {
                if (v.status === 'approved') {
                    const alloc = v.allocation || {};
                    carryoverUsedInApproved += Number(alloc.carryover_days) || 0;
                }
            }
            
            // El carryover total original = disponible actual + ya usado en APROBADAS
            const carryoverTotalOriginal = (emp.vacation_carryover_days || 0) + carryoverUsedInApproved;
            
            console.log(`[DEBUG FIFO] Empleado: ${emp.full_name}`);
            console.log(`[DEBUG FIFO]   - carryover disponible ahora: ${emp.vacation_carryover_days || 0}`);
            console.log(`[DEBUG FIFO]   - carryover usado en APROBADAS: ${carryoverUsedInApproved}`);
            console.log(`[DEBUG FIFO]   - carryover TOTAL original: ${carryoverTotalOriginal}`);

            const employeeDetail = {
                employee_id: String(emp._id),
                full_name: emp.full_name,
                carryover_total: carryoverTotalOriginal,
                vacations: []
            };

            // Agrupar por vacation_year
            const byYear = {};
            for (const v of vacations) {
                const year = v.vacation_year || new Date(v.start_date).getUTCFullYear();
                if (!byYear[year]) byYear[year] = [];
                byYear[year].push(v);
            }

            // Procesar cada año en orden - recalcular FIFO para TODAS las solicitudes
            const years = Object.keys(byYear).map(Number).sort();
            let carryoverRemaining = carryoverTotalOriginal;

            for (const year of years) {
                const yearVacations = byYear[year].sort((a, b) =>
                    new Date(a.created_at || a.start_date) - new Date(b.created_at || b.start_date)
                );

                for (const v of yearVacations) {
                    const alloc = v.allocation || {};
                    const existingCarry = Number(alloc.carryover_days) || 0;
                    const existingCurrent = Number(alloc.current_year_days) || 0;
                    const totalDays = Number(v.days) || 0;

                    console.log(`[DEBUG FIFO]   Solicitud ${v._id} (${totalDays} días, año ${year}):`);
                    console.log(`[DEBUG FIFO]     - carryoverRemaining antes: ${carryoverRemaining}`);

                    // Calcular FIFO correcto: primero carryover, luego año actual
                    const correctCarryDays = Math.min(carryoverRemaining, totalDays);
                    const correctCurrentDays = totalDays - correctCarryDays;

                    console.log(`[DEBUG FIFO]     - allocation existente: carry=${existingCarry}, current=${existingCurrent}`);
                    console.log(`[DEBUG FIFO]     - allocation CORRECTO:  carry=${correctCarryDays}, current=${correctCurrentDays}`);

                    // Verificar si el allocation actual coincide con FIFO correcto
                    const isCorrect = existingCarry === correctCarryDays && existingCurrent === correctCurrentDays;

                    if (isCorrect) {
                        // Ya está correcto, descontar del carryover disponible
                        carryoverRemaining -= correctCarryDays;
                        console.log(`[DEBUG FIFO]     - CORRECTO (no cambio), carryoverRemaining después: ${carryoverRemaining}`);
                        results.vacations_already_valid++;
                        continue;
                    }

                    // Necesita corrección
                    employeeDetail.vacations.push({
                        vacation_id: String(v._id),
                        year: year,
                        days: totalDays,
                        old_allocation: { carryover_days: existingCarry, current_year_days: existingCurrent },
                        new_allocation: { carryover_days: correctCarryDays, current_year_days: correctCurrentDays },
                        fixed: !dryRun
                    });

                    if (!dryRun) {
                        await Vacation.findByIdAndUpdate(v._id, {
                            $set: {
                                allocation: {
                                    carryover_days: correctCarryDays,
                                    current_year_days: correctCurrentDays
                                }
                            }
                        });
                    }

                    // Descontar del carryover disponible
                    carryoverRemaining -= correctCarryDays;
                    console.log(`[DEBUG FIFO]     - CORREGIDO, carryoverRemaining después: ${carryoverRemaining}`);
                    results.vacations_fixed++;
                }
            }

            if (employeeDetail.vacations.length > 0) {
                results.details.push(employeeDetail);
            }
        }

        // Registrar en auditoría
        if (!dryRun && results.vacations_fixed > 0) {
            await logAudit({
                action: 'maintenance_fix_vacation_allocation',
                userId: req.user.id,
                username: req.user.username,
                userRole: req.user.role,
                entityType: 'System',
                entityId: 'maintenance',
                employeeId: '',
                employeeLocation: '',
                before: null,
                after: { vacations_fixed: results.vacations_fixed },
                meta: { dry_run: dryRun }
            });
        }

        res.json({
            success: true,
            message: dryRun
                ? `Simulación completada. Se arreglarían ${results.vacations_fixed} solicitudes.`
                : `Proceso completado. Se arreglaron ${results.vacations_fixed} solicitudes.`,
            results
        });

    } catch (error) {
        console.error('Error en fix-vacation-allocation:', error);
        res.status(500).json({ error: 'Error al ejecutar el proceso de corrección' });
    }
});

/**
 * GET /api/settings/maintenance/vacation-allocation-status
 * Devuelve el estado actual de las solicitudes de vacaciones
 * y cuántas tienen allocation FIFO incorrecto.
 */
router.get('/maintenance/vacation-allocation-status', authenticateToken, async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
        }

        // Obtener todos los empleados activos
        const employees = await Employee.find({ status: { $ne: 'inactive' } }).lean();
        
        let totalVacations = 0;
        let validCount = 0;
        let invalidCount = 0;
        const invalidByEmployee = {};

        for (const emp of employees) {
            const vacations = await Vacation.find({
                employee_id: emp._id,
                type: 'vacation',
                status: { $in: ['approved', 'pending'] }
            }).sort({ created_at: 1 }).lean();

            if (vacations.length === 0) continue;

            // Calcular carryover TOTAL disponible:
            // Solo sumamos carryover de solicitudes APROBADAS (ya descontadas del empleado)
            // NO de PENDIENTES (su allocation puede estar mal)
            let carryoverUsedInApproved = 0;
            for (const v of vacations) {
                if (v.status === 'approved') {
                    const alloc = v.allocation || {};
                    carryoverUsedInApproved += Number(alloc.carryover_days) || 0;
                }
            }
            const carryoverTotalOriginal = (emp.vacation_carryover_days || 0) + carryoverUsedInApproved;

            // Agrupar por año
            const byYear = {};
            for (const v of vacations) {
                const year = v.vacation_year || new Date(v.start_date).getUTCFullYear();
                if (!byYear[year]) byYear[year] = [];
                byYear[year].push(v);
            }

            // Recalcular FIFO y comparar
            const years = Object.keys(byYear).map(Number).sort();
            let carryoverRemaining = carryoverTotalOriginal;

            for (const year of years) {
                const yearVacations = byYear[year].sort((a, b) =>
                    new Date(a.created_at || a.start_date) - new Date(b.created_at || b.start_date)
                );

                for (const v of yearVacations) {
                    totalVacations++;
                    const alloc = v.allocation || {};
                    const existingCarry = Number(alloc.carryover_days) || 0;
                    const existingCurrent = Number(alloc.current_year_days) || 0;
                    const totalDays = Number(v.days) || 0;

                    // Calcular FIFO correcto
                    const correctCarryDays = Math.min(carryoverRemaining, totalDays);
                    const correctCurrentDays = totalDays - correctCarryDays;

                    // Verificar si coincide
                    const isCorrect = existingCarry === correctCarryDays && existingCurrent === correctCurrentDays;

                    if (isCorrect) {
                        validCount++;
                    } else {
                        invalidCount++;
                        const empId = String(emp._id);
                        if (!invalidByEmployee[empId]) {
                            invalidByEmployee[empId] = { 
                                full_name: emp.full_name,
                                count: 0, 
                                total_days: 0,
                                carryover_available: carryoverTotalOriginal
                            };
                        }
                        invalidByEmployee[empId].count++;
                        invalidByEmployee[empId].total_days += totalDays;
                    }

                    carryoverRemaining -= correctCarryDays;
                }
            }
        }

        const invalidDetails = Object.entries(invalidByEmployee).map(([id, data]) => ({
            employee_id: id,
            full_name: data.full_name,
            vacations_invalid: data.count,
            total_days_affected: data.total_days,
            carryover_available: data.carryover_available
        }));

        res.json({
            total_vacations: totalVacations,
            valid_allocation: validCount,
            invalid_allocation: invalidCount,
            needs_fix: invalidCount > 0,
            invalid_details: invalidDetails
        });

    } catch (error) {
        console.error('Error en vacation-allocation-status:', error);
        res.status(500).json({ error: 'Error al obtener estado' });
    }
});

// =====================================================
// BACKUP SYSTEM ENDPOINTS
// =====================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups', 'mongo');
const DEFAULT_KEEP = Number.isFinite(Number(process.env.BACKUP_KEEP)) ? Number(process.env.BACKUP_KEEP) : 30;

// Utilidades de backup
function toSafeTimestamp(d = new Date()) {
    return d.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const s = fs.createReadStream(filePath);
        s.on('error', reject);
        s.on('data', (chunk) => hash.update(chunk));
        s.on('end', () => resolve(hash.digest('hex')));
    });
}

function listBackupFolders(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .reverse();
}

function rotateBackups(typedDir, keep) {
    const folders = listBackupFolders(typedDir);
    const toDelete = folders.slice(keep);
    for (const name of toDelete) {
        const full = path.join(typedDir, name);
        try {
            fs.rmSync(full, { recursive: true, force: true });
        } catch (e) {
            console.warn('⚠️  No se pudo borrar backup antiguo:', full, e && e.message ? e.message : e);
        }
    }
    return { total: folders.length, deleted: toDelete.length };
}

// Función principal de backup MongoDB (ejecutada inline)
async function createMongoBackup(options = {}) {
    const { verify = true, keep = DEFAULT_KEEP } = options;
    const mongoose = require('mongoose');
    
    const typedDir = BACKUP_DIR;
    ensureDir(typedDir);

    const backupName = toSafeTimestamp(new Date());
    const outDir = path.join(typedDir, backupName);
    ensureDir(outDir);

    const modelNames = mongoose.modelNames().slice().sort();
    if (modelNames.length === 0) {
        throw new Error('No se encontraron modelos de Mongoose para exportar.');
    }

    const manifest = {
        type: 'mongo',
        createdAt: new Date().toISOString(),
        models: [],
        files: [],
        app: {
            name: 'employee-management-system',
            version: (() => {
                try {
                    const pkg = require('../../package.json');
                    return pkg && pkg.version ? pkg.version : null;
                } catch (_) {
                    return null;
                }
            })()
        }
    };

    for (const modelName of modelNames) {
        const Model = mongoose.model(modelName);
        const fileBase = `${modelName}.jsonl`;
        const filePath = path.join(outDir, fileBase);

        let count = 0;
        const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
        const cursor = Model.find({}).lean().cursor();
        for await (const doc of cursor) {
            ws.write(JSON.stringify(doc) + '\n');
            count += 1;
        }
        await new Promise((resolve, reject) => {
            ws.end(() => resolve());
            ws.on('error', reject);
        });

        const stats = fs.statSync(filePath);
        const entry = {
            model: modelName,
            collection: Model.collection && Model.collection.name ? Model.collection.name : null,
            count,
            file: fileBase,
            bytes: stats.size
        };
        manifest.models.push({ name: modelName, collection: entry.collection, count });
        manifest.files.push(entry);
    }

    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    if (verify) {
        const fileHashes = [];
        for (const f of manifest.files) {
            const fp = path.join(outDir, f.file);
            const hash = await sha256File(fp);
            fileHashes.push({ file: f.file, sha256: hash });
        }
        const manifestHash = await sha256File(manifestPath);
        fs.writeFileSync(
            path.join(outDir, 'checksums.json'), 
            JSON.stringify({ files: fileHashes, manifest: { file: 'manifest.json', sha256: manifestHash } }, null, 2), 
            'utf8'
        );
    }

    rotateBackups(typedDir, keep);

    return {
        backupName,
        outDir,
        models: manifest.models.length,
        totalDocs: manifest.models.reduce((sum, m) => sum + m.count, 0)
    };
}

// GET /api/settings/backups/debug - Diagnóstico del sistema de backups
router.get('/backups/debug', authenticateToken, isAdmin, async (req, res) => {
    try {
        const info = {
            BACKUP_DIR_env: process.env.BACKUP_DIR || '(no definida)',
            BACKUP_DIR_used: BACKUP_DIR,
            cwd: process.cwd(),
            __dirname: __dirname,
            dir_exists: fs.existsSync(BACKUP_DIR),
            parent_exists: fs.existsSync(path.dirname(BACKUP_DIR)),
            app_backups_exists: fs.existsSync('/app/backups'),
            app_backups_mongo_exists: fs.existsSync('/app/backups/mongo'),
        };

        // Intentar listar contenido
        try {
            if (fs.existsSync('/app/backups')) {
                info.app_backups_contents = fs.readdirSync('/app/backups');
            }
        } catch (e) {
            info.app_backups_error = e.message;
        }

        try {
            if (fs.existsSync(BACKUP_DIR)) {
                info.backup_dir_contents = fs.readdirSync(BACKUP_DIR);
            }
        } catch (e) {
            info.backup_dir_error = e.message;
        }

        // Verificar permisos escribiendo un archivo de prueba
        try {
            const testFile = path.join(BACKUP_DIR, '.write-test');
            ensureDir(BACKUP_DIR);
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            info.write_permission = true;
        } catch (e) {
            info.write_permission = false;
            info.write_error = e.message;
        }

        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/settings/backups - Listar backups disponibles
router.get('/backups', authenticateToken, isAdmin, async (req, res) => {
    try {
        const backupDir = BACKUP_DIR;
        
        if (!fs.existsSync(backupDir)) {
            return res.json({ backups: [], total: 0 });
        }

        const folders = fs.readdirSync(backupDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => {
                const manifestPath = path.join(backupDir, d.name, 'manifest.json');
                let manifest = null;
                let size = 0;

                try {
                    if (fs.existsSync(manifestPath)) {
                        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    }
                    
                    // Calcular tamaño total
                    const files = fs.readdirSync(path.join(backupDir, d.name));
                    for (const file of files) {
                        const stat = fs.statSync(path.join(backupDir, d.name, file));
                        size += stat.size;
                    }
                } catch (e) {
                    console.error(`Error leyendo backup ${d.name}:`, e.message);
                }

                return {
                    name: d.name,
                    created_at: manifest?.createdAt || null,
                    models_count: manifest?.models?.length || 0,
                    models: manifest?.models || [],
                    size_bytes: size,
                    size_mb: (size / (1024 * 1024)).toFixed(2),
                    has_checksums: fs.existsSync(path.join(backupDir, d.name, 'checksums.json'))
                };
            })
            .sort((a, b) => (b.name || '').localeCompare(a.name || ''));

        res.json({
            backups: folders,
            total: folders.length,
            backup_dir: backupDir
        });

    } catch (error) {
        console.error('Error listando backups:', error);
        res.status(500).json({ error: 'Error al listar backups' });
    }
});

// POST /api/settings/backups/create - Crear nuevo backup
router.post('/backups/create', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { verify = true } = req.body;

        // Crear backup directamente (sin spawn)
        const result = await createMongoBackup({ verify });

        // Log de auditoría
        await logAudit({
            action: 'backup_created',
            user_id: req.user.id,
            user_name: req.user.username,
            entity_type: 'system',
            entity_id: 'backup',
            changes: { 
                backup_name: result.backupName, 
                verify,
                models: result.models,
                total_docs: result.totalDocs
            }
        });

        res.json({
            success: true,
            message: 'Backup creado correctamente',
            backup_name: result.backupName,
            models: result.models,
            total_docs: result.totalDocs
        });

    } catch (error) {
        console.error('Error creando backup:', error);
        res.status(500).json({ error: 'Error al crear backup: ' + (error.message || 'Error desconocido') });
    }
});

// GET /api/settings/backups/:name/download - Descargar un backup como ZIP
router.get('/backups/:name/download', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { name } = req.params;
        const backupPath = path.join(BACKUP_DIR, name);

        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup no encontrado' });
        }

        // Crear un archivo tar.gz en memoria
        const archiver = require('archiver');
        const archive = archiver('zip', { zlib: { level: 9 } });

        res.attachment(`backup-${name}.zip`);
        archive.pipe(res);
        archive.directory(backupPath, name);
        await archive.finalize();

        // Log de auditoría
        await logAudit({
            action: 'backup_downloaded',
            user_id: req.user.id,
            user_name: req.user.username,
            entity_type: 'system',
            entity_id: 'backup',
            changes: { backup_name: name }
        });

    } catch (error) {
        console.error('Error descargando backup:', error);
        res.status(500).json({ error: 'Error al descargar backup' });
    }
});

// DELETE /api/settings/backups/:name - Eliminar un backup
router.delete('/backups/:name', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { name } = req.params;
        const backupPath = path.join(BACKUP_DIR, name);

        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup no encontrado' });
        }

        // Eliminar recursivamente
        fs.rmSync(backupPath, { recursive: true, force: true });

        // Log de auditoría
        await logAudit({
            action: 'backup_deleted',
            user_id: req.user.id,
            user_name: req.user.username,
            entity_type: 'system',
            entity_id: 'backup',
            changes: { backup_name: name }
        });

        res.json({ success: true, message: 'Backup eliminado correctamente' });

    } catch (error) {
        console.error('Error eliminando backup:', error);
        res.status(500).json({ error: 'Error al eliminar backup' });
    }
});

// POST /api/settings/backups/:name/restore - Restaurar un backup
router.post('/backups/:name/restore', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { name } = req.params;
        const { create_safety_backup = true } = req.body;
        const backupPath = path.join(BACKUP_DIR, name);

        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup no encontrado' });
        }

        const manifestPath = path.join(backupPath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            return res.status(400).json({ error: 'Backup inválido: falta manifest.json' });
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const mongoose = require('mongoose');

        // Crear backup de seguridad antes de restaurar
        let safetyBackupName = null;
        if (create_safety_backup) {
            try {
                const safetyResult = await createMongoBackup({ verify: false });
                safetyBackupName = safetyResult.backupName;
            } catch (safetyError) {
                console.error('Error creando backup de seguridad:', safetyError);
                // Continuar sin backup de seguridad pero avisar
            }
        }

        // Restaurar cada modelo
        const results = {
            models_restored: 0,
            documents_restored: 0,
            details: []
        };

        for (const modelInfo of (manifest.models || [])) {
            const modelName = modelInfo.name;
            const filePath = path.join(backupPath, `${modelName}.jsonl`);

            if (!fs.existsSync(filePath)) {
                results.details.push({ model: modelName, status: 'skipped', reason: 'file not found' });
                continue;
            }

            try {
                // Cargar modelo si no está registrado
                try {
                    mongoose.model(modelName);
                } catch (e) {
                    // Modelo no registrado, intentar cargarlo
                    const modelPath = path.join(__dirname, '..', 'models', `${modelName}.js`);
                    if (fs.existsSync(modelPath)) {
                        require(modelPath);
                    }
                }

                const Model = mongoose.model(modelName);
                
                // Leer documentos del archivo JSONL
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.trim().split('\n').filter(l => l.trim());
                const docs = lines.map(l => JSON.parse(l));

                // Borrar datos existentes y restaurar
                await Model.deleteMany({});
                if (docs.length > 0) {
                    await Model.insertMany(docs, { ordered: false });
                }

                results.models_restored++;
                results.documents_restored += docs.length;
                results.details.push({ model: modelName, status: 'restored', documents: docs.length });

            } catch (modelError) {
                console.error(`Error restaurando modelo ${modelName}:`, modelError);
                results.details.push({ model: modelName, status: 'error', error: modelError.message });
            }
        }

        // Log de auditoría
        await logAudit({
            action: 'backup_restored',
            user_id: req.user.id,
            user_name: req.user.username,
            entity_type: 'system',
            entity_id: 'backup',
            changes: { 
                backup_name: name,
                safety_backup: safetyBackupName,
                models_restored: results.models_restored,
                documents_restored: results.documents_restored
            }
        });

        res.json({
            success: true,
            message: 'Backup restaurado correctamente',
            safety_backup: safetyBackupName,
            results
        });

    } catch (error) {
        console.error('Error restaurando backup:', error);
        res.status(500).json({ error: 'Error al restaurar backup' });
    }
});

module.exports = router;
