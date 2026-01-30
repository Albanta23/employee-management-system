const mongoose = require('mongoose');
require('dotenv').config();

const Employee = require('./src/models/Employee');

async function checkDavidBalance() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB');

        // Buscar David Redondo González
        const david = await Employee.findOne({
            $or: [
                { full_name: /david.*redondo.*gonzalez/i },
                { full_name: /redondo.*gonzalez.*david/i }
            ]
        }).lean();

        if (!david) {
            console.log('❌ No se encontró a David Redondo González');
            const all = await Employee.find({}).select('_id full_name vacation_carryover_days').limit(10).lean();
            console.log('Empleados disponibles:');
            all.forEach(e => console.log(`  ${e._id}: ${e.full_name} (carryover: ${e.vacation_carryover_days})`));
        } else {
            console.log('✓ Empleado encontrado:');
            console.log(`  ID: ${david._id}`);
            console.log(`  Nombre: ${david.full_name}`);
            console.log(`  vacation_carryover_days: ${david.vacation_carryover_days}`);
            console.log(`  status: ${david.status}`);
        }

        await mongoose.disconnect();
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

checkDavidBalance();
