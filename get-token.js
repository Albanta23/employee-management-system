const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('./src/models/User');

async function getToken() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB');

        // Buscar un admin para obtener token
        const admin = await User.findOne({ role: 'admin' }).lean();

        if (!admin) {
            console.log('❌ No se encontró admin');
            const users = await User.find({}).select('_id email role').limit(5).lean();
            console.log('Usuarios disponibles:');
            users.forEach(u => console.log(`  ${u._id}: ${u.email} (${u.role})`));
            process.exit(1);
        }

        const token = jwt.sign(
            { id: admin._id, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        console.log('✓ Token generado:');
        console.log(token);

        await mongoose.disconnect();
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

getToken();
