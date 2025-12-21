const Settings = require('../models/Settings');
const Employee = require('../models/Employee');

const SETTINGS_CACHE_TTL_MS = 60 * 1000;
const STORE_LOCATIONS_CACHE_TTL_MS = 5 * 60 * 1000;
const STORE_EMPLOYEE_IDS_CACHE_TTL_MS = 60 * 1000;

const settingsCache = {
    fetchedAt: 0,
    value: null,
    pendingPromise: null
};

const storeLocationsCache = {
    fetchedAt: 0,
    key: '',
    value: [],
    pendingPromise: null
};

const storeEmployeeIdsCache = {
    fetchedAt: 0,
    key: '',
    value: [],
    pendingPromise: null
};

function normalizeLocation(value) {
    const s = (value == null ? '' : String(value)).trim();
    if (!s) return '';
    // Quitar acentos para comparar "fábrica" == "fabrica"
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isFactoryLocation(location) {
    const normalized = normalizeLocation(location);
    if (!normalized) return false;
    // Regla simple: todo lo que contenga "fabrica" se considera fábrica
    return normalized.includes('fabrica') || normalized.includes('factory');
}

async function getSettingsForAccess() {
    const now = Date.now();
    if (settingsCache.value && (now - settingsCache.fetchedAt) < SETTINGS_CACHE_TTL_MS) {
        return settingsCache.value;
    }

    if (settingsCache.pendingPromise) {
        return settingsCache.pendingPromise;
    }

    settingsCache.pendingPromise = (async () => {
        // Usamos lean() para evitar overhead de documentos Mongoose cuando solo leemos.
        const settings = await Settings.findOne().lean().maxTimeMS(15000);
        const value = settings || new Settings().toObject();
        settingsCache.value = value;
        settingsCache.fetchedAt = Date.now();
        return value;
    })();

    try {
        return await settingsCache.pendingPromise;
    } finally {
        settingsCache.pendingPromise = null;
    }
}

function isStoreCoordinator(user) {
    return !!user && user.role === 'store_coordinator';
}

function isAdmin(user) {
    return !!user && user.role === 'admin';
}

async function requireFeatureAccess(req, res, featureKey) {
    if (isAdmin(req.user)) return true;

    if (!isStoreCoordinator(req.user)) {
        res.status(403).json({ error: 'Acceso denegado' });
        return false;
    }

    const settings = await getSettingsForAccess();

    if (!settings.store_coordinator_enabled) {
        res.status(403).json({ error: 'Perfil de Coordinador desactivado' });
        return false;
    }

    const featuresRequiringScope = new Set(['employees', 'attendance', 'vacations', 'absences', 'permissions', 'reports']);
    if (featuresRequiringScope.has(featureKey)) {
        const storeLocations = await getStoreLocations();
        if (storeLocations.length === 0) {
            res.status(403).json({ error: 'No hay ubicaciones de tienda disponibles (todas parecen ser fábrica o están vacías)' });
            return false;
        }
    }

    const access = settings.store_coordinator_access || {};
    if (!access[featureKey]) {
        res.status(403).json({ error: 'Acceso denegado para esta sección' });
        return false;
    }

    return true;
}

async function getStoreLocations() {
    const settings = await getSettingsForAccess();
    const configured = Array.isArray(settings.store_locations) ? settings.store_locations : [];
    const cleanedConfigured = configured
        .map(l => (l == null ? '' : String(l)).trim())
        .filter(Boolean);

    // Key para cache: si hay lista configurada, depende de esa lista; si no, depende del modo "derived".
    const key = cleanedConfigured.length > 0 ? `configured:${cleanedConfigured.join('|')}` : 'derived';
    const now = Date.now();
    if (
        storeLocationsCache.key === key &&
        storeLocationsCache.value &&
        (now - storeLocationsCache.fetchedAt) < STORE_LOCATIONS_CACHE_TTL_MS
    ) {
        return storeLocationsCache.value;
    }

    if (storeLocationsCache.pendingPromise && storeLocationsCache.key === key) {
        return storeLocationsCache.pendingPromise;
    }

    storeLocationsCache.key = key;
    storeLocationsCache.pendingPromise = (async () => {
        let result;
        if (cleanedConfigured.length > 0) {
            result = Array.from(new Set(cleanedConfigured));
        } else {
            // Si el admin no configura lista de tiendas, derivamos: todo lo que NO sea fábrica.
            const allLocations = await Employee.distinct('location').maxTimeMS(15000);
            const derived = (allLocations || [])
                .map(l => (l == null ? '' : String(l)).trim())
                .filter(Boolean)
                .filter(l => !isFactoryLocation(l));
            result = Array.from(new Set(derived));
        }
        storeLocationsCache.value = result;
        storeLocationsCache.fetchedAt = Date.now();
        return result;
    })();

    try {
        return await storeLocationsCache.pendingPromise;
    } finally {
        storeLocationsCache.pendingPromise = null;
    }
}

async function getStoreEmployeeIds() {
    const storeLocations = await getStoreLocations();
    const key = storeLocations.join('|');
    const now = Date.now();
    if (
        storeEmployeeIdsCache.key === key &&
        storeEmployeeIdsCache.value &&
        (now - storeEmployeeIdsCache.fetchedAt) < STORE_EMPLOYEE_IDS_CACHE_TTL_MS
    ) {
        return storeEmployeeIdsCache.value;
    }

    if (storeEmployeeIdsCache.pendingPromise && storeEmployeeIdsCache.key === key) {
        return storeEmployeeIdsCache.pendingPromise;
    }

    if (storeLocations.length === 0) {
        storeEmployeeIdsCache.key = key;
        storeEmployeeIdsCache.value = [];
        storeEmployeeIdsCache.fetchedAt = now;
        return [];
    }

    storeEmployeeIdsCache.key = key;
    storeEmployeeIdsCache.pendingPromise = (async () => {
        const employees = await Employee.find({
            location: { $in: storeLocations },
            status: { $ne: 'inactive' }
        })
            .select('_id')
            .lean()
            .maxTimeMS(15000);

        const ids = employees.map(e => String(e._id));
        storeEmployeeIdsCache.value = ids;
        storeEmployeeIdsCache.fetchedAt = Date.now();
        return ids;
    })();

    try {
        return await storeEmployeeIdsCache.pendingPromise;
    } finally {
        storeEmployeeIdsCache.pendingPromise = null;
    }
}

async function getAllowedEmployeeIdSetForUser(user) {
    if (isAdmin(user)) return null; // null => sin restricción

    if (!isStoreCoordinator(user)) return new Set();

    const settings = await getSettingsForAccess();
    if (!settings.store_coordinator_enabled) return new Set();

    const ids = await getStoreEmployeeIds();
    return new Set(ids);
}

async function ensureEmployeeInScope(req, res, employeeId) {
    if (isAdmin(req.user)) return true;

    if (!isStoreCoordinator(req.user)) {
        res.status(403).json({ error: 'Acceso denegado' });
        return false;
    }

    const settings = await getSettingsForAccess();
    if (!settings.store_coordinator_enabled) {
        res.status(403).json({ error: 'Perfil de Coordinador desactivado' });
        return false;
    }

    const storeLocations = await getStoreLocations();
    if (storeLocations.length === 0) {
        res.status(403).json({ error: 'No hay ubicaciones de tienda disponibles (todas parecen ser fábrica o están vacías)' });
        return false;
    }

    // Comprobación eficiente: traemos solo location/status del empleado y validamos.
    const employee = await Employee.findById(employeeId)
        .select('location status')
        .lean()
        .maxTimeMS(15000);

    if (!employee) {
        res.status(404).json({ error: 'Empleado no encontrado' });
        return false;
    }

    if (employee.status === 'inactive') {
        res.status(403).json({ error: 'Acceso denegado a este empleado' });
        return false;
    }

    if (!storeLocations.includes(String(employee.location))) {
        res.status(403).json({ error: 'Acceso denegado a este empleado' });
        return false;
    }

    return true;
}

module.exports = {
    isStoreCoordinator,
    isAdmin,
    requireFeatureAccess,
    getSettingsForAccess,
    getStoreLocations,
    getStoreEmployeeIds,
    getAllowedEmployeeIdSetForUser,
    ensureEmployeeInScope
};
