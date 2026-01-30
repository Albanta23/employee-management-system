// Script para probar edición de vacaciones con recalcuelo FIFO
// Ejecutar: node scripts/test-vacation-edit-fifo.js

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Employee = require('../src/models/Employee');
const Vacation = require('../src/models/Vacation');

async function testEditFIFO() {
    try {
        console.log('📝 Probando edición de vacaciones con FIFO...\n');
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB\n');

        // Buscar la solicitud que reparamos
        const vacation = await Vacation.findById('697ca3b4138c5de4fcc9373b');
        if (!vacation) {
            console.log('❌ Solicitud no encontrada');
            process.exit(1);
        }

        const emp = await Employee.findById(vacation.employee_id).lean();
        
        console.log('📋 Solicitud ANTES de edición:');
        console.log(`   ID: ${vacation._id}`);
        console.log(`   Empleado: ${emp.full_name}`);
        console.log(`   Días: ${vacation.days}`);
        console.log(`   Allocation: carryover=${vacation.allocation.carryover_days}, current=${vacation.allocation.current_year_days}`);
        console.log(`   Carryover disponible (Empleado): ${emp.vacation_carryover_days}`);
        console.log(`\n💡 Simulando edición: CAMBIAR de 14 días a 20 días\n`);

        // Simular lo que haría el API
        // 1. Liberar carryover anterior
        const oldCarry = vacation.allocation.carryover_days;
        console.log(`1️⃣  Liberando carryover anterior: ${oldCarry} días`);
        emp.vacation_carryover_days += oldCarry;
        console.log(`   Carryover disponible (ahora): ${emp.vacation_carryover_days}`);

        // 2. Recalcular FIFO con 20 días
        const newTotalDays = 20;
        console.log(`\n2️⃣  Recalculando FIFO para ${newTotalDays} días`);
        console.log(`   Carryover disponible: ${emp.vacation_carryover_days}`);
        
        const carryoverToUse = Math.min(emp.vacation_carryover_days, newTotalDays);
        const currentYearToUse = newTotalDays - carryoverToUse;
        
        console.log(`   ✓ Nueva asignación: carryover=${carryoverToUse}, current=${currentYearToUse}`);

        // 3. Reservar nuevo carryover
        console.log(`\n3️⃣  Reservando nuevo carryover: ${carryoverToUse} días`);
        emp.vacation_carryover_days -= carryoverToUse;
        console.log(`   Carryover disponible (después reserva): ${emp.vacation_carryover_days}`);

        console.log(`\n✅ Resultado esperado:`);
        console.log(`   Solicitud con ${newTotalDays} días:`);
        console.log(`   - Carryover: ${carryoverToUse}`);
        console.log(`   - Año actual: ${currentYearToUse}`);
        console.log(`   Empleado carryover después: ${emp.vacation_carryover_days}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

testEditFIFO();
