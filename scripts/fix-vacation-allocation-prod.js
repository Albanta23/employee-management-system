// Script para reparar asignaciones FIFO en producción
// Ejecutar: MONGODB_URI="tu_url" node scripts/fix-vacation-allocation-prod.js

const mongoose = require('mongoose');
require('dotenv').config();

const Employee = require('../src/models/Employee');
const Vacation = require('../src/models/Vacation');

async function fixVacationAllocationProd() {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            console.error('❌ MONGODB_URI no está definida');
            process.exit(1);
        }

        console.log('🔧 Reparando asignaciones FIFO en producción...');
        console.log(`📍 Base de datos: ${mongoUri.split('@')[1]?.split('?')[0] || 'desconocida'}\n`);
        
        await mongoose.connect(mongoUri);
        console.log('✓ Conectado a MongoDB\n');

        // Buscar TODAS las solicitudes con possible allocation incorrecta
        const vacations = await Vacation.find({
            status: { $in: ['pending', 'approved'] },
            days: { $gt: 0 },
            allocation: { $exists: true }
        }).lean();

        console.log(`Analizando ${vacations.length} solicitudes...\n`);

        let fixed = 0;
        let skipped = 0;
        const results = [];

        for (const v of vacations) {
            const emp = await Employee.findById(v.employee_id).lean();
            
            if (!emp) {
                skipped++;
                continue;
            }

            const totalDays = Number(v.days) || 0;
            const allocation = v.allocation || {};
            const currentCarryover = Number(allocation.carryover_days) || 0;
            const currentYearDays = Number(allocation.current_year_days) || 0;

            // Heurística: si carryover_days=0 pero hay carryover disponible Y 
            // current_year_days === total_days, probablemente sea un error
            const shouldHaveCarryover = currentCarryover === 0 && 
                                       (Number(emp.vacation_carryover_days) || 0) > 0 && 
                                       currentYearDays === totalDays;

            if (!shouldHaveCarryover) {
                skipped++;
                continue;
            }

            const carryoverAvailable = Number(emp.vacation_carryover_days) || 0;
            const carryoverToUse = Math.min(carryoverAvailable, totalDays);
            const currentYearToUse = totalDays - carryoverToUse;

            // Actualizar en BD
            await Vacation.findByIdAndUpdate(v._id, {
                allocation: {
                    carryover_days: carryoverToUse,
                    current_year_days: currentYearToUse
                }
            });

            results.push({
                vacationId: v._id.toString().substring(0, 12),
                employee: emp.full_name,
                totalDays,
                before: { carryover: currentCarryover, current: currentYearDays },
                after: { carryover: carryoverToUse, current: currentYearToUse }
            });

            fixed++;
        }

        console.log('📊 RESULTADOS:\n');
        if (results.length > 0) {
            console.log('Reparadas:');
            results.forEach(r => {
                console.log(`  • ${r.vacationId} - ${r.employee}`);
                console.log(`    ${r.totalDays} días: carryover ${r.before.carryover}→${r.after.carryover}, actual ${r.before.current}→${r.after.current}`);
            });
        }
        console.log(`\nTotal reparadas: ${fixed}`);
        console.log(`Total sin cambios: ${skipped}`);

        await mongoose.disconnect();
        console.log('\n✓ Proceso completado');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fixVacationAllocationProd();
