#!/usr/bin/env node

/**
 * Script para inicializar ubicaciones y tiendas de ejemplo
 * Ejecutar: node scripts/seed-locations.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Location = require('../src/models/Location');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/employee_management';

const sampleLocations = [
    {
        name: 'Madrid',
        description: 'Ubicación principal en la Comunidad de Madrid',
        stores: [
            {
                name: 'Tienda Madrid Centro',
                address: 'C/ Gran Vía 28, 28013 Madrid',
                localHolidays: [
                    {
                        date: new Date(new Date().getFullYear(), 4, 15), // 15 de mayo
                        name: 'San Isidro',
                        isRecurring: true
                    }
                ]
            },
            {
                name: 'Tienda Madrid Norte',
                address: 'C/ Bravo Murillo 123, 28020 Madrid',
                localHolidays: []
            }
        ]
    },
    {
        name: 'Barcelona',
        description: 'Ubicación en la Comunidad de Cataluña',
        stores: [
            {
                name: 'Tienda Barcelona Centro',
                address: 'Passeig de Gràcia 85, 08008 Barcelona',
                localHolidays: [
                    {
                        date: new Date(new Date().getFullYear(), 8, 24), // 24 de septiembre
                        name: 'La Mercè',
                        isRecurring: true
                    }
                ]
            }
        ]
    },
    {
        name: 'Valencia',
        description: 'Ubicación en la Comunidad Valenciana',
        stores: [
            {
                name: 'Tienda Valencia Centro',
                address: 'C/ Colón 20, 46004 Valencia',
                localHolidays: [
                    {
                        date: new Date(new Date().getFullYear(), 2, 19), // 19 de marzo
                        name: 'San José - Fallas',
                        isRecurring: true
                    }
                ]
            }
        ]
    }
];

async function seedLocations() {
    try {
        console.log('🔗 Conectando a MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Conectado a MongoDB');

        // Verificar si ya existen ubicaciones
        const existingCount = await Location.countDocuments();
        
        if (existingCount > 0) {
            console.log(`⚠️  Ya existen ${existingCount} ubicación(es) en la base de datos.`);
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            return new Promise((resolve) => {
                rl.question('¿Deseas eliminarlas y crear las de ejemplo? (s/n): ', async (answer) => {
                    rl.close();
                    if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'si') {
                        await Location.deleteMany({});
                        console.log('🗑️  Ubicaciones existentes eliminadas');
                        await insertLocations();
                    } else {
                        console.log('❌ Operación cancelada');
                    }
                    await mongoose.connection.close();
                    resolve();
                });
            });
        } else {
            await insertLocations();
            await mongoose.connection.close();
        }
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

async function insertLocations() {
    console.log('📍 Insertando ubicaciones de ejemplo...');
    
    for (const locationData of sampleLocations) {
        const location = new Location(locationData);
        await location.save();
        console.log(`✅ Ubicación creada: ${location.name} con ${location.stores.length} tienda(s)`);
    }
    
    console.log('\n🎉 ¡Ubicaciones de ejemplo creadas exitosamente!');
    console.log('\nResumen:');
    const locations = await Location.find();
    locations.forEach(loc => {
        console.log(`\n📍 ${loc.name}`);
        loc.stores.forEach(store => {
            console.log(`   🏪 ${store.name}`);
            if (store.localHolidays.length > 0) {
                console.log(`      📅 Festivos locales: ${store.localHolidays.length}`);
            }
        });
    });
}

// Ejecutar el script
seedLocations().catch(console.error);
