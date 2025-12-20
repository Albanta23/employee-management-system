const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const Employee = require('../src/models/Employee');
const User = require('../src/models/User');

async function generateLogins() {
    try {
        console.log('--- Iniciando Generación Masiva de Accesos ---');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB Atlas');

        const employees = await Employee.find({ status: 'active' });
        console.log(`Procesando ${employees.length} empleados activos...`);

        let created = 0;
        let updated = 0;

        for (const emp of employees) {
            // El DNI es el usuario, el Teléfono es la contraseña
            const username = emp.dni.trim().toUpperCase();
            const password = emp.phone.trim().replace(/\s/g, ''); // Sin espacios

            const hashedPassword = await bcrypt.hash(password, 10);

            const userUpdate = {
                username: username,
                password: hashedPassword,
                name: emp.full_name,
                email: emp.email,
                role: 'employee',
                employee_id: emp._id
            };

            // Buscar si ya tiene usuario por employee_id
            const existingUser = await User.findOne({ employee_id: emp._id });

            if (existingUser) {
                await User.findByIdAndUpdate(existingUser._id, userUpdate);
                updated++;
            } else {
                // Verificar si el username (DNI) ya está en uso por otro usuario
                const usernameConflict = await User.findOne({ username: username });
                if (usernameConflict) {
                    console.log(`⚠️ Conflicto: El DNI ${username} ya está registrado para otro usuario. Saltando ${emp.full_name}`);
                    continue;
                }
                await User.create(userUpdate);
                created++;
            }
        }

        console.log('\n--- Proceso Finalizado ---');
        console.log(`✅ Usuarios Creados: ${created}`);
        console.log(`🔄 Usuarios Actualizados: ${updated}`);
        process.exit(0);

    } catch (error) {
        console.error('❌ Error Crítico:', error);
        process.exit(1);
    }
}

generateLogins();
