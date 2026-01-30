/**
 * Script para arreglar el allocation (FIFO) de solicitudes de vacaciones antiguas
 * que fueron creadas antes de implementar el sistema FIFO de carryover.
 * 
 * El sistema FIFO consume primero los días de años anteriores (carryover)
 * antes de consumir días del año en vigor.
 * 
 * Ejecutar: node scripts/fix-vacation-allocation-fifo.js
 * 
 * Con --dry-run solo muestra lo que haría sin hacer cambios:
 * node scripts/fix-vacation-allocation-fifo.js --dry-run
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Vacation = require('../src/models/Vacation');
const Employee = require('../src/models/Employee');

const DRY_RUN = process.argv.includes('--dry-run');

async function fixVacationAllocationFIFO() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado a MongoDB');
        
        if (DRY_RUN) {
            console.log('🔍 MODO DRY-RUN: No se harán cambios reales\n');
        }

        // Obtener todos los empleados con carryover o que podrían tenerlo
        const employees = await Employee.find({ status: { $ne: 'inactive' } }).lean();
        console.log(`📋 Procesando ${employees.length} empleados...\n`);

        let totalFixed = 0;
        let totalSkipped = 0;

        for (const emp of employees) {
            // Obtener todas las vacaciones del empleado ordenadas por fecha de creación
            const vacations = await Vacation.find({
                employee_id: emp._id,
                type: 'vacation',
                status: { $in: ['approved', 'pending'] }
            }).sort({ created_at: 1 }).lean();

            if (vacations.length === 0) continue;

            // Agrupar por vacation_year
            const byYear = {};
            for (const v of vacations) {
                const year = v.vacation_year || new Date(v.start_date).getUTCFullYear();
                if (!byYear[year]) byYear[year] = [];
                byYear[year].push(v);
            }

            // Para cada año, calcular el allocation FIFO correcto
            // Necesitamos saber cuánto carryover tenía disponible al inicio de cada año
            
            // Primero calculamos el carryover TOTAL original del empleado
            // sumando lo que tiene ahora + lo que ya está reservado en solicitudes con allocation válido
            let carryoverAvailable = emp.vacation_carryover_days || 0;
            
            // Sumar días de carryover ya reservados en solicitudes existentes (de cualquier año)
            for (const v of vacations) {
                const alloc = v.allocation || {};
                carryoverAvailable += Number(alloc.carryover_days) || 0;
            }
            
            console.log(`👤 ${emp.full_name}:`);
            console.log(`   Carryover TOTAL disponible: ${carryoverAvailable}`);

            // Procesar cada año en orden
            const years = Object.keys(byYear).map(Number).sort();
            
            for (const year of years) {
                const yearVacations = byYear[year].sort((a, b) => 
                    new Date(a.created_at || a.start_date) - new Date(b.created_at || b.start_date)
                );

                console.log(`   📅 Año ${year}: ${yearVacations.length} solicitud(es)`);

                // Carryover disponible para este año (asumimos que se puede usar todo lo disponible)
                let yearCarryoverRemaining = carryoverAvailable;

                for (const v of yearVacations) {
                    const alloc = v.allocation || {};
                    const existingCarry = Number(alloc.carryover_days) || 0;
                    const existingCurrent = Number(alloc.current_year_days) || 0;
                    const totalDays = Number(v.days) || 0;

                    // Verificar si el allocation es válido
                    const isValid = (existingCarry + existingCurrent) === totalDays && totalDays > 0;

                    if (isValid) {
                        // Ya tiene allocation válido, descontar del carryover disponible
                        yearCarryoverRemaining -= existingCarry;
                        console.log(`      ✓ ID ${v._id}: ${totalDays} días - allocation válido (carry: ${existingCarry}, year: ${existingCurrent})`);
                        totalSkipped++;
                        continue;
                    }

                    // Necesita arreglo: calcular FIFO
                    const newCarryDays = Math.min(yearCarryoverRemaining, totalDays);
                    const newCurrentDays = totalDays - newCarryDays;

                    console.log(`      ⚠️  ID ${v._id}: ${totalDays} días - SIN allocation válido`);
                    console.log(`         → Nuevo allocation: carry=${newCarryDays}, year=${newCurrentDays}`);

                    if (!DRY_RUN) {
                        await Vacation.findByIdAndUpdate(v._id, {
                            $set: {
                                allocation: {
                                    carryover_days: newCarryDays,
                                    current_year_days: newCurrentDays
                                }
                            }
                        });
                        console.log(`         ✅ Actualizado`);
                    }

                    // Descontar del carryover disponible para la siguiente solicitud
                    yearCarryoverRemaining -= newCarryDays;
                    totalFixed++;
                }

                // Al final del año, el carryover restante pasa al siguiente
                // (simplificación: asumimos que el carryover no caduca entre años para este fix)
                carryoverAvailable = yearCarryoverRemaining;
            }

            // Actualizar el vacation_carryover_days del empleado
            // Debe ser el carryover restante después de todas las reservas
            if (!DRY_RUN && carryoverAvailable !== (emp.vacation_carryover_days || 0)) {
                const oldCarryover = emp.vacation_carryover_days || 0;
                // No actualizamos el carryover del empleado aquí porque eso se gestiona
                // de otra forma (cuando se aprueban/rechazan solicitudes)
                // Solo informamos si hay discrepancia
                if (Math.abs(carryoverAvailable - oldCarryover) > 0) {
                    console.log(`   ⚠️  Nota: Carryover actual (${oldCarryover}) difiere del calculado (${carryoverAvailable})`);
                }
            }

            console.log('');
        }

        console.log('='.repeat(50));
        console.log(`✅ Proceso completado`);
        console.log(`   - Solicitudes actualizadas: ${totalFixed}`);
        console.log(`   - Solicitudes ya correctas: ${totalSkipped}`);
        
        if (DRY_RUN) {
            console.log('\n🔍 Este fue un DRY-RUN. Ejecuta sin --dry-run para aplicar los cambios.');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixVacationAllocationFIFO();
