#!/usr/bin/env node

/**
 * Genera/actualiza Ubicaciones + Tiendas a partir de Employee.location
 * usando el mapeo indicado por el usuario:
 * - MORADAS BUS, CIRCULAR -> VALLADOLID
 * - SALAMANCA1, SALAMANCA2 -> SALAMANCA
 * - HAM -> TORO
 * - FABRICA -> FABRICA (ubicación propia)
 * - El resto -> ZAMORA
 *
 * Ejecutar:
 *   node scripts/seed-locations-from-employees.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Location = require('../src/models/Location');
const Employee = require('../src/models/Employee');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/employee_management';

function normalize(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

const LOCATION_NAMES = {
    VALLADOLID: 'VALLADOLID',
    SALAMANCA: 'SALAMANCA',
    TORO: 'TORO',
    FABRICA: 'FABRICA',
    ZAMORA: 'ZAMORA'
};

// Canonicalización de tiendas (clave normalizada -> { location, storeName })
const CANONICAL_STORE_MAP = new Map([
    ['MORADAS BUS', { location: LOCATION_NAMES.VALLADOLID, storeName: 'MORADAS BUS' }],
    ['CIRCULAR', { location: LOCATION_NAMES.VALLADOLID, storeName: 'CIRCULAR' }],

    // Salamanca (incluye variantes por si existe el typo sin 'C')
    ['SALAMANCA1', { location: LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA1' }],
    ['SALAMANCA2', { location: LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA2' }],
    ['SALAMANA1', { location: LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA1' }],
    ['SALAMANA2', { location: LOCATION_NAMES.SALAMANCA, storeName: 'SALAMANCA2' }],

    ['HAM', { location: LOCATION_NAMES.TORO, storeName: 'HAM' }],

    // Fábrica como ubicación propia
    ['FABRICA', { location: LOCATION_NAMES.FABRICA, storeName: 'FABRICA' }],
    ['FÁBRICA', { location: LOCATION_NAMES.FABRICA, storeName: 'FABRICA' }]
]);

function getTargetLocationAndStoreName(rawStoreName) {
    const norm = normalize(rawStoreName);
    const canonical = CANONICAL_STORE_MAP.get(norm);
    if (canonical) return canonical;
    return { location: LOCATION_NAMES.ZAMORA, storeName: String(rawStoreName || '').trim() };
}

async function ensureLocationWithStores(locationName, storeNames) {
    const normalizedStoreNames = new Map();
    for (const name of storeNames) {
        const trimmed = String(name || '').trim();
        if (!trimmed) continue;
        normalizedStoreNames.set(normalize(trimmed), trimmed);
    }

    let location = await Location.findOne({ name: locationName });
    const isNew = !location;
    if (!location) {
        location = new Location({
            name: locationName,
            description: '',
            stores: []
        });
    }

    const existing = new Set((location.stores || []).map(s => normalize(s.name)));
    let changed = false;

    for (const [norm, storeName] of normalizedStoreNames.entries()) {
        if (existing.has(norm)) continue;
        location.stores.push({ name: storeName, address: '', localHolidays: [] });
        changed = true;
    }

    if (isNew || changed) {
        await location.save();
    }

    return { location, isNew, changed };
}

async function main() {
    console.log('🔗 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    console.log('📥 Leyendo tiendas desde Employee.location...');
    const rawStores = await Employee.distinct('location', {
        location: { $exists: true, $ne: null, $ne: '' }
    });

    const grouped = new Map(); // locationName -> Set(storeName)

    // Asegurar que existan las ubicaciones “base” aunque no haya empleados aún
    for (const loc of Object.values(LOCATION_NAMES)) {
        grouped.set(loc, new Set());
    }

    // Asegurar tiendas canónicas aunque no existan en empleados
    for (const { location, storeName } of CANONICAL_STORE_MAP.values()) {
        grouped.get(location).add(storeName);
    }

    for (const raw of rawStores) {
        const trimmed = String(raw || '').trim();
        if (!trimmed) continue;
        const { location, storeName } = getTargetLocationAndStoreName(trimmed);
        if (!grouped.has(location)) grouped.set(location, new Set());
        grouped.get(location).add(storeName);
    }

    console.log('🧩 Aplicando mapeo y guardando ubicaciones/tiendas...');

    const results = [];
    for (const [locationName, storeSet] of grouped.entries()) {
        const storeNames = Array.from(storeSet);
        const res = await ensureLocationWithStores(locationName, storeNames);
        results.push({ locationName, ...res });
    }

    console.log('\n🎉 Seed completado. Resumen:');
    for (const r of results) {
        const count = r.location.stores?.length || 0;
        const flags = [r.isNew ? 'creada' : null, r.changed ? 'actualizada' : null].filter(Boolean);
        console.log(`- ${r.locationName}: ${count} tienda(s)${flags.length ? ` (${flags.join(', ')})` : ''}`);
    }

    await mongoose.connection.close();
    console.log('\n✅ Conexión cerrada');
}

main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
