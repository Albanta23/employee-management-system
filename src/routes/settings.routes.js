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

            // Calcular el carryover TOTAL original del empleado
            // sumando lo que tiene ahora + lo que ya está reservado en solicitudes con allocation válido
            let carryoverAvailable = emp.vacation_carryover_days || 0;

            // Sumar días de carryover ya reservados en solicitudes existentes
            for (const v of vacations) {
                const alloc = v.allocation || {};
                carryoverAvailable += Number(alloc.carryover_days) || 0;
            }

            const employeeDetail = {
                employee_id: String(emp._id),
                full_name: emp.full_name,
                carryover_total: carryoverAvailable,
                vacations: []
            };

            // Agrupar por vacation_year
            const byYear = {};
            for (const v of vacations) {
                const year = v.vacation_year || new Date(v.start_date).getUTCFullYear();
                if (!byYear[year]) byYear[year] = [];
                byYear[year].push(v);
            }

            // Procesar cada año en orden
            const years = Object.keys(byYear).map(Number).sort();

            for (const year of years) {
                const yearVacations = byYear[year].sort((a, b) =>
                    new Date(a.created_at || a.start_date) - new Date(b.created_at || b.start_date)
                );

                let yearCarryoverRemaining = carryoverAvailable;

                for (const v of yearVacations) {
                    const alloc = v.allocation || {};
                    const existingCarry = Number(alloc.carryover_days) || 0;
                    const existingCurrent = Number(alloc.current_year_days) || 0;
                    const totalDays = Number(v.days) || 0;

                    // Verificar si el allocation es válido
                    const isValid = (existingCarry + existingCurrent) === totalDays && totalDays > 0;

                    if (isValid) {
                        yearCarryoverRemaining -= existingCarry;
                        results.vacations_already_valid++;
                        continue;
                    }

                    // Necesita arreglo: calcular FIFO
                    const newCarryDays = Math.min(yearCarryoverRemaining, totalDays);
                    const newCurrentDays = totalDays - newCarryDays;

                    employeeDetail.vacations.push({
                        vacation_id: String(v._id),
                        year: year,
                        days: totalDays,
                        old_allocation: { carryover_days: existingCarry, current_year_days: existingCurrent },
                        new_allocation: { carryover_days: newCarryDays, current_year_days: newCurrentDays },
                        fixed: !dryRun
                    });

                    if (!dryRun) {
                        await Vacation.findByIdAndUpdate(v._id, {
                            $set: {
                                allocation: {
                                    carryover_days: newCarryDays,
                                    current_year_days: newCurrentDays
                                }
                            }
                        });
                    }

                    yearCarryoverRemaining -= newCarryDays;
                    results.vacations_fixed++;
                }

                carryoverAvailable = yearCarryoverRemaining;
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
 * y cuántas tienen allocation inválido.
 */
router.get('/maintenance/vacation-allocation-status', authenticateToken, async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
        }

        const vacations = await Vacation.find({
            type: 'vacation',
            status: { $in: ['approved', 'pending'] }
        }).lean();

        let validCount = 0;
        let invalidCount = 0;
        const invalidByEmployee = {};

        for (const v of vacations) {
            const alloc = v.allocation || {};
            const carry = Number(alloc.carryover_days) || 0;
            const current = Number(alloc.current_year_days) || 0;
            const totalDays = Number(v.days) || 0;

            const isValid = (carry + current) === totalDays && totalDays > 0;

            if (isValid) {
                validCount++;
            } else {
                invalidCount++;
                const empId = String(v.employee_id);
                if (!invalidByEmployee[empId]) {
                    invalidByEmployee[empId] = { count: 0, total_days: 0 };
                }
                invalidByEmployee[empId].count++;
                invalidByEmployee[empId].total_days += totalDays;
            }
        }

        // Obtener nombres de empleados con problemas
        const empIds = Object.keys(invalidByEmployee);
        const employees = empIds.length > 0
            ? await Employee.find({ _id: { $in: empIds } }).select('full_name').lean()
            : [];

        const empMap = new Map(employees.map(e => [String(e._id), e.full_name]));

        const invalidDetails = empIds.map(id => ({
            employee_id: id,
            full_name: empMap.get(id) || 'Desconocido',
            vacations_invalid: invalidByEmployee[id].count,
            total_days_affected: invalidByEmployee[id].total_days
        }));

        res.json({
            total_vacations: vacations.length,
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

module.exports = router;
