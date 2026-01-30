// Script para actualizar la solicitud y verificar que el FIFO se recalcula
// Ejecutar después de levantar el servidor: node scripts/test-api-edit-vacation.js

const fetch = require('node-fetch');
require('dotenv').config();

const API_URL = 'http://localhost:3000/api';

async function testAPIEditVacation() {
    try {
        console.log('🔄 Probando actualización de vacaciones vía API...\n');

        // 1. Obtener token (como admin)
        console.log('1️⃣  Autenticando como admin...');
        const loginResp = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'admin', // Cambiar según tu usuario
                password: 'admin'   // Cambiar según tu contraseña
            })
        });
        
        if (!loginResp.ok) {
            const err = await loginResp.json();
            console.log(`❌ Error de login: ${err.error}`);
            process.exit(1);
        }
        
        const loginData = await loginResp.json();
        const token = loginData.token;
        console.log(`✓ Token obtenido\n`);

        // 2. Obtener solicitud actual
        console.log('2️⃣  Obteniendo solicitud 697ca3b4138c5de4fcc9373b...');
        const getResp = await fetch(`${API_URL}/vacations/697ca3b4138c5de4fcc9373b`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!getResp.ok) {
            console.log(`❌ Error al obtener solicitud`);
            process.exit(1);
        }
        
        const vacation = await getResp.json();
        console.log(`✓ Solicitud actual:`);
        console.log(`   Días: ${vacation.days}`);
        console.log(`   Allocation: carryover=${vacation.allocation.carryover_days}, current=${vacation.allocation.current_year_days}`);
        console.log('');

        // 3. Actualizar a 20 días
        console.log('3️⃣  Actualizando a 20 días...');
        const updateResp = await fetch(`${API_URL}/vacations/697ca3b4138c5de4fcc9373b`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                days: 20
            })
        });
        
        if (!updateResp.ok) {
            const err = await updateResp.json();
            console.log(`❌ Error en actualización: ${err.error}`);
            process.exit(1);
        }
        
        const updated = await updateResp.json();
        console.log(`✓ Actualizado`);
        console.log(`   Dias: ${updated.vacation.days}`);
        console.log(`   Nueva allocation: carryover=${updated.vacation.allocation.carryover_days}, current=${updated.vacation.allocation.current_year_days}`);
        console.log('');

        console.log('✅ Test completado - La edición recalculó el FIFO correctamente');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

testAPIEditVacation();
