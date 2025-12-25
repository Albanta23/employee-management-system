const express = require('express');
const router = express.Router();
const Location = require('../models/Location');
const Holiday = require('../models/Holiday');
const Employee = require('../models/Employee');
const { authenticateToken } = require('../middleware/auth');
const { requireFeatureAccess, getStoreLocations, isAdmin } = require('../utils/accessScope');

function normalizeStoreName(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

function normalizeForCompare(value) {
    const s = (value == null ? '' : String(value)).trim();
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isFactoryName(value) {
    const normalized = normalizeForCompare(value);
    if (!normalized) return false;
    return normalized.includes('fabrica') || normalized.includes('factory');
}

/**
 * GET /api/locations/:id/employees
 * Devuelve empleados de las tiendas de una ubicación (solo admin). Incluye tiendas/fábrica.
 */
router.get('/:id/employees', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden ver empleados por ubicación' });
        }

        const hasAccess = await requireFeatureAccess(req, res, 'locations');
        if (!hasAccess) return;

        const location = await Location.findById(req.params.id).lean();
        if (!location) return res.status(404).json({ error: 'Ubicación no encontrada' });

        const storeNames = (location.stores || [])
            .map(s => String(s.name || '').trim())
            .filter(Boolean);

        if (storeNames.length === 0) {
            return res.json({ employees: [] });
        }

        const employees = await Employee.find({
            status: { $ne: 'inactive' },
            location: { $in: storeNames }
        })
            .select('_id full_name dni position location status')
            .sort({ full_name: 1 })
            .lean()
            .maxTimeMS(15000);

        const formattedEmployees = (employees || []).map(e => ({
            ...e,
            id: String(e._id),
            _id: String(e._id)
        }));

        res.json({ employees: formattedEmployees });
    } catch (error) {
        console.error('Error obteniendo empleados por ubicación:', error);
        res.status(500).json({ error: 'Error al obtener empleados por ubicación' });
    }
});

const BOOTSTRAP_LOCATION_NAMES = {
    VALLADOLID: 'VALLADOLID',
    SALAMANCA: 'SALAMANCA',
    TORO: 'TORO',
    FABRICA: 'FABRICA',
    ZAMORA: 'ZAMORA',
    SIN_ASIGNAR: 'SIN ASIGNAR'
};

// Mapeo solicitado por el usuario:
// MORADAS BUS, CIRCULAR -> VALLADOLID
// SALAMANCA1, SALAMANCA2 -> SALAMANCA (incluye tolerancia SALAMANA1/2)
// HAM -> TORO
// FABRICA -> FABRICA
// resto -> SIN ASIGNAR
const BOOTSTRAP_STORE_MAP = new Map([
    ['MORADAS BUS', { location: BOOTSTRAP_LOCATION_NAMES.VALLADOLID, storeName: 'MORADAS BUS' }],
    ['CIRCULAR', { location: BOOTSTRAP_LOCATION_NAMES.VALLADOLID, storeName: 'CIRCULAR' }],
    ['SALAMANCA1', { location: BOOTSTRAP_LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA1' }],
    ['SALAMANCA2', { location: BOOTSTRAP_LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA2' }],
    ['SALAMANA1', { location: BOOTSTRAP_LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA1' }],
    ['SALAMANA2', { location: BOOTSTRAP_LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA2' }],
    ['HAM', { location: BOOTSTRAP_LOCATION_NAMES.TORO, storeName: 'HAM' }],
    ['FABRICA', { location: BOOTSTRAP_LOCATION_NAMES.FABRICA, storeName: 'FABRICA' }],
    ['FÁBRICA', { location: BOOTSTRAP_LOCATION_NAMES.FABRICA, storeName: 'FABRICA' }]
]);

function mapStoreToLocation(rawStoreName) {
    const norm = normalizeStoreName(rawStoreName);
    const hit = BOOTSTRAP_STORE_MAP.get(norm);
    if (hit) return hit;
    return { location: BOOTSTRAP_LOCATION_NAMES.SIN_ASIGNAR, storeName: String(rawStoreName || '').trim() };
}

async function bootstrapLocationsFromEmployeesIfEmpty() {
    const existing = await Location.countDocuments({ active: true });
    if (existing > 0) return false;

    const rawStores = await Employee.distinct('location', {
        location: { $exists: true, $ne: null, $ne: '' }
    });

    const grouped = new Map(); // locationName -> Map(normalizedStoreName -> storeName)
    for (const loc of Object.values(BOOTSTRAP_LOCATION_NAMES)) {
        grouped.set(loc, new Map());
    }

    // Asegurar tiendas canónicas aunque no existan en empleados todavía
    for (const { location, storeName } of BOOTSTRAP_STORE_MAP.values()) {
        grouped.get(location).set(normalizeStoreName(storeName), storeName);
    }

    for (const raw of rawStores) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) continue;
        const { location, storeName } = mapStoreToLocation(trimmed);
        if (!grouped.has(location)) grouped.set(location, new Map());
        grouped.get(location).set(normalizeStoreName(storeName), storeName);
    }

    for (const [locationName, storeMap] of grouped.entries()) {
        let locDoc = await Location.findOne({ name: locationName });
        if (!locDoc) {
            locDoc = new Location({ name: locationName, description: '', stores: [] });
        }

        const existingStores = new Set((locDoc.stores || []).map(s => normalizeStoreName(s.name)));
        for (const storeName of storeMap.values()) {
            const norm = normalizeStoreName(storeName);
            if (existingStores.has(norm)) continue;
            locDoc.stores.push({ name: storeName, address: '', localHolidays: [] });
        }

        await locDoc.save();
    }

    return true;
}

/**
 * GET /api/locations
 * Obtiene todas las ubicaciones
 * Admin: ve todas las ubicaciones
 * Coordinador: solo ve ubicaciones que contienen tiendas en su scope
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Verificar acceso
        const hasAccess = await requireFeatureAccess(req, res, 'locations');
        if (!hasAccess) return;

        // Si no hay ubicaciones todavía y el usuario es admin, autogenerar desde Employee.location
        if (isAdmin(req.user)) {
            try {
                await bootstrapLocationsFromEmployeesIfEmpty();
            } catch (e) {
                console.warn('⚠️ No se pudo autogenerar ubicaciones:', e && e.message ? e.message : e);
            }
        }

        let locations = await Location.find({ active: true })
            .sort({ name: 1 })
            .lean();

        // Si es coordinador, filtrar por tiendas permitidas
        if (!isAdmin(req.user)) {
            const allowedStores = await getStoreLocations();
            locations = locations.map(location => {
                const filteredStores = location.stores.filter(store => 
                    allowedStores.includes(store.name)
                );
                return {
                    ...location,
                    stores: filteredStores
                };
            }).filter(location => location.stores.length > 0);
        }

        res.json(locations);
    } catch (error) {
        console.error('Error obteniendo ubicaciones:', error);
        res.status(500).json({ error: 'Error al obtener ubicaciones' });
    }
});

/**
 * GET /api/locations/:id
 * Obtiene una ubicación específica con sus tiendas
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'locations');
        if (!hasAccess) return;

        const location = await Location.findById(req.params.id).lean();
        
        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        // Filtrar tiendas si es coordinador
        if (!isAdmin(req.user)) {
            const allowedStores = await getStoreLocations();
            location.stores = location.stores.filter(store => 
                allowedStores.includes(store.name)
            );
        }

        res.json(location);
    } catch (error) {
        console.error('Error obteniendo ubicación:', error);
        res.status(500).json({ error: 'Error al obtener ubicación' });
    }
});

/**
 * POST /api/locations/admin/fix-zamora
 * Reasigna (solo admin) tiendas que estén dentro de ZAMORA a su ubicación mapeada.
 * Las no mapeadas pasan a "SIN ASIGNAR".
 * Esto evita que ZAMORA concentre todas las tiendas por el antiguo fallback.
 */
router.post('/admin/fix-zamora', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden ejecutar esta acción' });
        }

        const hasAccess = await requireFeatureAccess(req, res, 'locations');
        if (!hasAccess) return;

        const dryRun = String((req.query && req.query.dryRun) || '').trim() === '1';

        const zamora = await Location.findOne({ name: BOOTSTRAP_LOCATION_NAMES.ZAMORA }).maxTimeMS(15000);
        if (!zamora) {
            return res.status(404).json({ error: 'Ubicación ZAMORA no encontrada' });
        }

        let unassigned = await Location.findOne({ name: BOOTSTRAP_LOCATION_NAMES.SIN_ASIGNAR }).maxTimeMS(15000);
        if (!unassigned) {
            unassigned = new Location({ name: BOOTSTRAP_LOCATION_NAMES.SIN_ASIGNAR, description: '', stores: [] });
        }

        // Índices por nombre normalizado para evitar duplicados.
        const normSetFor = (doc) => new Set((doc.stores || []).map(s => normalizeStoreName(s.name)));
        const unassignedNorm = normSetFor(unassigned);

        // Cargar/crear docs destino para ubicaciones canónicas del bootstrap.
        const destinationDocs = new Map();
        const destinationNormSets = new Map();
        for (const locName of Object.values(BOOTSTRAP_LOCATION_NAMES)) {
            if (!locName || locName === BOOTSTRAP_LOCATION_NAMES.ZAMORA) continue;
            if (locName === BOOTSTRAP_LOCATION_NAMES.SIN_ASIGNAR) {
                destinationDocs.set(locName, unassigned);
                destinationNormSets.set(locName, unassignedNorm);
                continue;
            }
            let doc = await Location.findOne({ name: locName }).maxTimeMS(15000);
            if (!doc) doc = new Location({ name: locName, description: '', stores: [] });
            destinationDocs.set(locName, doc);
            destinationNormSets.set(locName, normSetFor(doc));
        }

        const moved = [];
        const kept = [];

        // Reasignamos solo lo que está dentro de ZAMORA.
        const newZamoraStores = [];
        for (const store of (zamora.stores || [])) {
            const storeName = String(store && store.name ? store.name : '').trim();
            if (!storeName) continue;

            const { location: targetLocation, storeName: canonicalStoreName } = mapStoreToLocation(storeName);
            const target = String(targetLocation || '').trim();
            const canonical = String(canonicalStoreName || storeName).trim();

            // Si el target sigue siendo ZAMORA, lo dejamos.
            if (target === BOOTSTRAP_LOCATION_NAMES.ZAMORA) {
                newZamoraStores.push({ ...store.toObject(), name: canonical });
                kept.push({ store: storeName, to: target });
                continue;
            }

            const destDoc = destinationDocs.get(target) || unassigned;
            const destKey = destinationDocs.has(target) ? target : BOOTSTRAP_LOCATION_NAMES.SIN_ASIGNAR;
            const destNorm = destinationNormSets.get(destKey) || unassignedNorm;
            const n = normalizeStoreName(canonical);

            if (!destNorm.has(n)) {
                // Clonamos campos básicos; preservamos address/localHolidays/active si existían.
                const storeObj = store.toObject ? store.toObject() : { ...store };
                storeObj.name = canonical;
                (destDoc.stores = destDoc.stores || []).push(storeObj);
                destNorm.add(n);
            }

            moved.push({ store: storeName, to: target });
        }

        // Actualizar ZAMORA (sin los movidos) y guardar destinos.
        zamora.stores = newZamoraStores;

        if (!dryRun) {
            await Promise.all([
                zamora.save(),
                ...Array.from(destinationDocs.values()).map(d => d.save())
            ]);
        }

        res.json({
            ok: true,
            dryRun,
            movedCount: moved.length,
            keptCount: kept.length,
            moved,
            kept,
            note: 'Se reasignaron tiendas desde ZAMORA según el bootstrap actual (resto -> SIN ASIGNAR).'
        });
    } catch (error) {
        console.error('Error en fix-zamora:', error);
        res.status(500).json({ error: 'Error al ejecutar fix-zamora' });
    }
});

/**
 * POST /api/locations
 * Crea una nueva ubicación (solo admin)
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden crear ubicaciones' });
        }

        const { name, description, stores } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre de la ubicación es requerido' });
        }

        // Verificar que no exista ya
        const existing = await Location.findOne({ name: name.trim() });
        if (existing) {
            return res.status(400).json({ error: 'Ya existe una ubicación con ese nombre' });
        }

        const location = new Location({
            name: name.trim(),
            description: description || '',
            stores: stores || []
        });

        await location.save();
        res.status(201).json(location);
    } catch (error) {
        console.error('Error creando ubicación:', error);
        res.status(500).json({ error: 'Error al crear ubicación' });
    }
});

/**
 * PUT /api/locations/:id
 * Actualiza una ubicación (solo admin)
 */
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden modificar ubicaciones' });
        }

        const { name, description, active } = req.body;
        const location = await Location.findById(req.params.id);

        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        if (name && name.trim() && name !== location.name) {
            // Verificar que el nuevo nombre no exista
            const existing = await Location.findOne({ name: name.trim(), _id: { $ne: req.params.id } });
            if (existing) {
                return res.status(400).json({ error: 'Ya existe una ubicación con ese nombre' });
            }
            location.name = name.trim();
        }

        if (description !== undefined) location.description = description;
        if (active !== undefined) location.active = active;

        await location.save();
        res.json(location);
    } catch (error) {
        console.error('Error actualizando ubicación:', error);
        res.status(500).json({ error: 'Error al actualizar ubicación' });
    }
});

/**
 * DELETE /api/locations/:id
 * Elimina una ubicación (solo admin)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden eliminar ubicaciones' });
        }

        const location = await Location.findById(req.params.id);
        
        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        // Verificar si hay empleados en alguna de las tiendas
        const storeNames = location.stores.map(s => s.name);
        const employeesInStores = await Employee.countDocuments({ 
            location: { $in: storeNames } 
        });

        if (employeesInStores > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar. Hay ${employeesInStores} empleado(s) asignado(s) a tiendas de esta ubicación` 
            });
        }

        await Location.findByIdAndDelete(req.params.id);
        res.json({ message: 'Ubicación eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando ubicación:', error);
        res.status(500).json({ error: 'Error al eliminar ubicación' });
    }
});

/**
 * POST /api/locations/:id/stores
 * Añade una tienda a una ubicación (solo admin)
 */
router.post('/:id/stores', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden añadir tiendas' });
        }

        const { name, address } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre de la tienda es requerido' });
        }

        const location = await Location.findById(req.params.id);
        
        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        // Verificar que no exista ya en esta ubicación
        const storeExists = location.stores.some(s => s.name === name.trim());
        if (storeExists) {
            return res.status(400).json({ error: 'Ya existe una tienda con ese nombre en esta ubicación' });
        }

        location.stores.push({
            name: name.trim(),
            address: address || '',
            localHolidays: []
        });

        await location.save();
        res.status(201).json(location);
    } catch (error) {
        console.error('Error añadiendo tienda:', error);
        res.status(500).json({ error: 'Error al añadir tienda' });
    }
});

/**
 * PUT /api/locations/:id/stores/:storeId
 * Actualiza una tienda (solo admin)
 */
router.put('/:id/stores/:storeId', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden modificar tiendas' });
        }

        const { name, address, active } = req.body;
        const location = await Location.findById(req.params.id);

        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        const store = location.stores.id(req.params.storeId);
        
        if (!store) {
            return res.status(404).json({ error: 'Tienda no encontrada' });
        }

        if (name && name.trim() && name !== store.name) {
            // Verificar que el nuevo nombre no exista en esta ubicación
            const nameExists = location.stores.some(s => 
                s.name === name.trim() && s._id.toString() !== req.params.storeId
            );
            if (nameExists) {
                return res.status(400).json({ error: 'Ya existe una tienda con ese nombre en esta ubicación' });
            }
            store.name = name.trim();
        }

        if (address !== undefined) store.address = address;
        if (active !== undefined) store.active = active;

        await location.save();
        res.json(location);
    } catch (error) {
        console.error('Error actualizando tienda:', error);
        res.status(500).json({ error: 'Error al actualizar tienda' });
    }
});

/**
 * POST /api/locations/:id/stores/:storeId/move
 * Mueve una tienda de una ubicación a otra (solo admin)
 */
router.post('/:id/stores/:storeId/move', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden mover tiendas' });
        }

        const { toLocationId } = req.body || {};
        if (!toLocationId) {
            return res.status(400).json({ error: 'toLocationId es requerido' });
        }

        if (String(toLocationId) === String(req.params.id)) {
            return res.status(400).json({ error: 'La ubicación destino debe ser distinta' });
        }

        const [fromLocation, toLocation] = await Promise.all([
            Location.findById(req.params.id),
            Location.findById(toLocationId)
        ]);

        if (!fromLocation) {
            return res.status(404).json({ error: 'Ubicación origen no encontrada' });
        }
        if (!toLocation) {
            return res.status(404).json({ error: 'Ubicación destino no encontrada' });
        }

        // Bloquear movimientos hacia/desde "Fábrica"
        if (isFactoryName(fromLocation.name) || isFactoryName(toLocation.name)) {
            return res.status(400).json({ error: 'No se permite mover tiendas hacia/desde Fábrica' });
        }

        const store = fromLocation.stores.id(req.params.storeId);
        if (!store) {
            return res.status(404).json({ error: 'Tienda no encontrada en la ubicación origen' });
        }

        const storeName = String(store.name || '').trim();
        if (!storeName) {
            return res.status(400).json({ error: 'La tienda no tiene nombre válido' });
        }

        if (isFactoryName(storeName)) {
            return res.status(400).json({ error: 'No se permite mover tiendas de Fábrica' });
        }

        const existsInTarget = (toLocation.stores || []).some(s =>
            normalizeStoreName(s.name) === normalizeStoreName(storeName)
        );
        if (existsInTarget) {
            return res.status(400).json({ error: 'Ya existe una tienda con ese nombre en la ubicación destino' });
        }

        const storeObj = store.toObject();
        fromLocation.stores.pull(store._id);
        toLocation.stores.push(storeObj);

        await Promise.all([fromLocation.save(), toLocation.save()]);

        res.json({
            message: 'Tienda movida correctamente',
            fromLocationId: String(fromLocation._id),
            toLocationId: String(toLocation._id),
            storeId: String(storeObj._id)
        });
    } catch (error) {
        console.error('Error moviendo tienda:', error);
        res.status(500).json({ error: 'Error al mover tienda' });
    }
});

/**
 * DELETE /api/locations/:id/stores/:storeId
 * Elimina una tienda de una ubicación (solo admin)
 */
router.delete('/:id/stores/:storeId', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ error: 'Solo administradores pueden eliminar tiendas' });
        }

        const location = await Location.findById(req.params.id);

        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        const store = location.stores.id(req.params.storeId);
        
        if (!store) {
            return res.status(404).json({ error: 'Tienda no encontrada' });
        }

        // Verificar si hay empleados en esta tienda
        const employeesCount = await Employee.countDocuments({ location: store.name });
        
        if (employeesCount > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar. Hay ${employeesCount} empleado(s) asignado(s) a esta tienda` 
            });
        }

        location.stores.pull(req.params.storeId);
        await location.save();
        
        res.json({ message: 'Tienda eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando tienda:', error);
        res.status(500).json({ error: 'Error al eliminar tienda' });
    }
});

/**
 * GET /api/locations/:id/stores/:storeId/calendar/:year
 * Obtiene el calendario completo (festivos nacionales + locales) para una tienda
 */
router.get('/:id/stores/:storeId/calendar/:year', authenticateToken, async (req, res) => {
    try {
        const hasAccess = await requireFeatureAccess(req, res, 'locations');
        if (!hasAccess) return;

        const year = parseInt(req.params.year);
        if (isNaN(year) || year < 2000 || year > 2100) {
            return res.status(400).json({ error: 'Año inválido' });
        }

        const location = await Location.findById(req.params.id).lean();

        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        const store = location.stores.find(s => s._id.toString() === req.params.storeId);
        
        if (!store) {
            return res.status(404).json({ error: 'Tienda no encontrada' });
        }

        // Verificar permisos del coordinador
        if (!isAdmin(req.user)) {
            const allowedStores = await getStoreLocations();
            if (!allowedStores.includes(store.name)) {
                return res.status(403).json({ error: 'No tienes permiso para ver esta tienda' });
            }
        }

        // Obtener festivos nacionales del año
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59);
        
        const nationalHolidays = await Holiday.find({
            type: 'national',
            date: { $gte: startDate, $lte: endDate }
        }).lean();

        // Combinar festivos nacionales con locales de la tienda
        const localHolidays = store.localHolidays
            .filter(h => {
                const holidayDate = new Date(h.date);
                return holidayDate.getFullYear() === year;
            })
            .map(h => ({
                ...h,
                type: 'local',
                storeName: store.name
            }));

        const allHolidays = [
            ...nationalHolidays.map(h => ({ ...h, type: 'national' })),
            ...localHolidays
        ].sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json({
            year,
            locationName: location.name,
            storeName: store.name,
            holidays: allHolidays
        });
    } catch (error) {
        console.error('Error obteniendo calendario:', error);
        res.status(500).json({ error: 'Error al obtener calendario' });
    }
});

/**
 * POST /api/locations/:id/stores/:storeId/holidays
 * Añade un festivo local a una tienda
 * Admin y coordinador (si tiene acceso a esa tienda)
 */
router.post('/:id/stores/:storeId/holidays', authenticateToken, async (req, res) => {
    try {
        const { date, name, isRecurring } = req.body;

        if (!date || !name) {
            return res.status(400).json({ error: 'Fecha y nombre son requeridos' });
        }

        const location = await Location.findById(req.params.id);

        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        const store = location.stores.id(req.params.storeId);
        
        if (!store) {
            return res.status(404).json({ error: 'Tienda no encontrada' });
        }

        // Verificar permisos del coordinador
        if (!isAdmin(req.user)) {
            const allowedStores = await getStoreLocations();
            if (!allowedStores.includes(store.name)) {
                return res.status(403).json({ error: 'No tienes permiso para modificar esta tienda' });
            }
        }

        const holidayDate = new Date(date);
        
        // Verificar que no exista ya ese día
        const exists = store.localHolidays.some(h => {
            const existingDate = new Date(h.date);
            return existingDate.toDateString() === holidayDate.toDateString();
        });

        if (exists) {
            return res.status(400).json({ error: 'Ya existe un festivo local en esa fecha' });
        }

        store.localHolidays.push({
            date: holidayDate,
            name: name.trim(),
            isRecurring: isRecurring || false
        });

        await location.save();
        res.status(201).json(location);
    } catch (error) {
        console.error('Error añadiendo festivo local:', error);
        res.status(500).json({ error: 'Error al añadir festivo local' });
    }
});

/**
 * PUT /api/locations/:id/stores/:storeId/holidays/:holidayId
 * Actualiza un festivo local
 */
router.put('/:id/stores/:storeId/holidays/:holidayId', authenticateToken, async (req, res) => {
    try {
        const { date, name, isRecurring } = req.body;
        const location = await Location.findById(req.params.id);

        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        const store = location.stores.id(req.params.storeId);
        
        if (!store) {
            return res.status(404).json({ error: 'Tienda no encontrada' });
        }

        // Verificar permisos del coordinador
        if (!isAdmin(req.user)) {
            const allowedStores = await getStoreLocations();
            if (!allowedStores.includes(store.name)) {
                return res.status(403).json({ error: 'No tienes permiso para modificar esta tienda' });
            }
        }

        const holiday = store.localHolidays.id(req.params.holidayId);
        
        if (!holiday) {
            return res.status(404).json({ error: 'Festivo no encontrado' });
        }

        if (date) holiday.date = new Date(date);
        if (name) holiday.name = name.trim();
        if (isRecurring !== undefined) holiday.isRecurring = isRecurring;

        await location.save();
        res.json(location);
    } catch (error) {
        console.error('Error actualizando festivo local:', error);
        res.status(500).json({ error: 'Error al actualizar festivo local' });
    }
});

/**
 * DELETE /api/locations/:id/stores/:storeId/holidays/:holidayId
 * Elimina un festivo local
 */
router.delete('/:id/stores/:storeId/holidays/:holidayId', authenticateToken, async (req, res) => {
    try {
        const location = await Location.findById(req.params.id);

        if (!location) {
            return res.status(404).json({ error: 'Ubicación no encontrada' });
        }

        const store = location.stores.id(req.params.storeId);
        
        if (!store) {
            return res.status(404).json({ error: 'Tienda no encontrada' });
        }

        // Verificar permisos del coordinador
        if (!isAdmin(req.user)) {
            const allowedStores = await getStoreLocations();
            if (!allowedStores.includes(store.name)) {
                return res.status(403).json({ error: 'No tienes permiso para modificar esta tienda' });
            }
        }

        store.localHolidays.pull(req.params.holidayId);
        await location.save();
        
        res.json({ message: 'Festivo local eliminado correctamente' });
    } catch (error) {
        console.error('Error eliminando festivo local:', error);
        res.status(500).json({ error: 'Error al eliminar festivo local' });
    }
});

module.exports = router;
