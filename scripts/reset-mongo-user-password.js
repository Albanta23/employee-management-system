#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const User = require('../src/models/User');

function parseArgs(argv) {
    const args = {};
    for (const raw of argv) {
        if (!raw.startsWith('--')) continue;
        const [k, ...rest] = raw.slice(2).split('=');
        const v = rest.length ? rest.join('=') : true;
        args[k] = v;
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const username = String(args.username || 'admin').trim();
    const newPassword = args.password ? String(args.password) : null;
    const setMustChange = args.mustChange === true || String(args.mustChange || '').toLowerCase() === 'true';

    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI no está definida en el entorno (.env).');
        process.exit(1);
    }

    if (!newPassword || newPassword.length < 4) {
        console.error('❌ Debes indicar --password=... (mínimo 4 caracteres).');
        console.error('Ejemplo: node scripts/reset-mongo-user-password.js --username=admin --password=admin1234');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updated = await User.findOneAndUpdate(
        { username },
        {
            $set: {
                password: hashedPassword,
                mustChangePassword: setMustChange
            }
        },
        { new: true }
    ).select('username role mustChangePassword');

    if (!updated) {
        console.error(`❌ No existe el usuario '${username}' en MongoDB. No se actualizó nada.`);
        process.exit(1);
    }

    console.log('✅ Contraseña actualizada en MongoDB');
    console.log({ username: updated.username, role: updated.role, mustChangePassword: updated.mustChangePassword, db: mongoose.connection.name });
}

main()
    .catch((e) => {
        console.error('❌ Error:', e && e.message ? e.message : e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
