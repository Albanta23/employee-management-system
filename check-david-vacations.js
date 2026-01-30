const mongoose = require('mongoose');
require('dotenv').config();

const Vacation = require('./src/models/Vacation');

async function checkDavidVacations() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB');

        const davidId = '694681a222efab5b362939c6';
        
        // Buscar vacaciones de David en 2026
        const vacations = await Vacation.find({
            employee_id: davidId,
            vacation_year: 2026,
            status: { $in: ['pending', 'approved'] }
        }).select('_id days allocation status start_date').lean();

        console.log(`\nVacaciones de David Redondo González (${davidId}) en 2026:`);
        console.log(`Total encontradas: ${vacations.length}`);
        
        vacations.forEach((v, i) => {
            console.log(`\n[${i+1}] ${v._id}`);
            console.log(`    Estado: ${v.status}`);
            console.log(`    Días: ${v.days}`);
            console.log(`    Allocation: ${JSON.stringify(v.allocation)}`);
            console.log(`    Fecha inicio: ${v.start_date ? new Date(v.start_date).toLocaleDateString('es-ES') : '-'}`);
        });

        await mongoose.disconnect();
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

checkDavidVacations();
