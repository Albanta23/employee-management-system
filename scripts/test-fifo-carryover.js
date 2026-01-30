// Script de prueba para verificar el cálculo FIFO de vacaciones
// Ejecutar: node scripts/test-fifo-carryover.js

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Employee = require('../src/models/Employee');
const Vacation = require('../src/models/Vacation');

async function testFIFOCarryover() {
    try {
        console.log('🔍 Iniciando prueba de FIFO Carryover...\n');
        
        // Conectar a MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB\n');

        // Buscar empleados con vacaciones pendientes
        const vacations = await Vacation.find({
            status: 'pending',
            days: { $gt: 0 }
        }).populate('employee_id').limit(5);

        if (vacations.length === 0) {
            console.log('ℹ  No hay vacaciones pendientes para probar.');
            process.exit(0);
        }

        console.log(`Encontradas ${vacations.length} solicitudes pendientes:\n`);

        for (const v of vacations) {
            const empId = v.employee_id?._id || v.employee_id;
            const emp = await Employee.findById(empId).lean();
            
            console.log(`📋 Solicitud ID: ${v._id}`);
            console.log(`   Empleado: ${emp?.full_name || empId}`);
            console.log(`   Fechas: ${v.start_date.toISOString().split('T')[0]} a ${v.end_date.toISOString().split('T')[0]}`);
            console.log(`   Total días: ${v.days}`);
            console.log(`   Allocation: ${JSON.stringify(v.allocation)}`);
            console.log(`   Estado: ${v.status}`);
            
            // Mostrar carryover disponible del empleado
            console.log(`   Carryover disponible (Empleado): ${emp?.vacation_carryover_days || 0}`);
            
            // Verificar si debería usar carryover
            if (v.days && emp?.vacation_carryover_days) {
                const shouldUseCarryover = Math.min(v.days, emp.vacation_carryover_days);
                const shouldUseCurrent = v.days - shouldUseCarryover;
                
                console.log(`   ⚠️  ESPERADO - Carryover: ${shouldUseCarryover}, Año actual: ${shouldUseCurrent}`);
                
                if (v.allocation) {
                    const actualCarryover = v.allocation.carryover_days || 0;
                    const actualCurrent = v.allocation.current_year_days || 0;
                    
                    if (actualCarryover !== shouldUseCarryover || actualCurrent !== shouldUseCurrent) {
                        console.log(`   ❌ MISMATCH! Actual - Carryover: ${actualCarryover}, Año actual: ${actualCurrent}`);
                    } else {
                        console.log(`   ✓ Correcto`);
                    }
                } else {
                    console.log(`   ❌ Sin allocation (legacy)`);
                }
            }
            console.log('');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

testFIFOCarryover();
