// Script para reparar solicitudes de vacaciones con allocation incorrecta
// Ejecutar: node scripts/fix-vacation-allocation.js

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Employee = require('../src/models/Employee');
const Vacation = require('../src/models/Vacation');

async function fixVacationAllocation() {
    try {
        console.log('🔧 Reparando asignaciones de vacaciones (FIFO)...\n');
        
        // Conectar a MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB\n');

        // Buscar solicitudes con posible allocation incorrecta
        const vacations = await Vacation.find({
            status: { $in: ['pending', 'approved'] },
            days: { $gt: 0 },
            allocation: { $exists: true }
        });

        console.log(`Encontradas ${vacations.length} solicitudes para verificar.\n`);

        let fixed = 0;
        let skipped = 0;

        for (const v of vacations) {
            const empId = v.employee_id;
            const emp = await Employee.findById(empId).lean();
            
            if (!emp) {
                console.log(`⚠️  Empleado ${empId} no encontrado, saltando...`);
                skipped++;
                continue;
            }

            const totalDays = Number(v.days) || 0;
            const allocation = v.allocation || {};
            const currentCarryover = Number(allocation.carryover_days) || 0;
            const currentYearDays = Number(allocation.current_year_days) || 0;

            // Recalcular FIFO
            // IMPORTANTE: El carryover que DEBERÍA tener es lo que se reservó.
            // Pero como no sabemos exactamente cuánto había cuando se creó, 
            // usamos una heurística: si tiene allocation.carryover_days === 0 y carryover disponible > 0,
            // probablemente se creó antes del fix.

            const carryoverAvailable = Number(emp.vacation_carryover_days) || 0;
            
            // Heurística: si carryover_days=0 pero hay carryover disponible Y 
            // (carryover_days + current_year_days) === total_days,
            // PUEDE que sea un error.
            const shouldHaveCarryover = currentCarryover === 0 && carryoverAvailable > 0 && 
                                       (currentCarryover + currentYearDays) === totalDays &&
                                       currentYearDays === totalDays;

            if (!shouldHaveCarryover) {
                console.log(`✓ ${v._id.toString().substring(0, 8)} - OK (carryover: ${currentCarryover}, current: ${currentYearDays})`);
                skipped++;
                continue;
            }

            console.log(`🔄 Reparando ${v._id.toString().substring(0, 8)}`);
            console.log(`   Empleado: ${emp.full_name || empId}`);
            console.log(`   Total días: ${totalDays}`);
            console.log(`   Carryover disponible: ${carryoverAvailable}`);

            // Recalcular asignación
            const carryoverToUse = Math.min(carryoverAvailable, totalDays);
            const currentYearToUse = totalDays - carryoverToUse;

            console.log(`   NUEVO - Carryover: ${carryoverToUse}, Año actual: ${currentYearToUse}`);

            // Actualizar
            v.allocation = {
                carryover_days: carryoverToUse,
                current_year_days: currentYearToUse
            };
            
            await v.save();
            console.log(`   ✓ Actualizada\n`);
            fixed++;
        }

        console.log(`\n📊 Resultados:`);
        console.log(`   Reparadas: ${fixed}`);
        console.log(`   Sin cambios: ${skipped}`);
        console.log(`\n✓ Proceso completado`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixVacationAllocation();
