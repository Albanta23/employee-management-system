#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

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

function toBool(v, defaultValue = false) {
    if (v === undefined) return defaultValue;
    if (v === true) return true;
    const s = String(v).toLowerCase().trim();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function pickUserFields(doc, { keepEmployeeId }) {
    const out = {
        username: doc.username,
        password: doc.password,
        name: doc.name,
        email: doc.email,
        role: doc.role,
        mustChangePassword: doc.mustChangePassword
    };

    if (keepEmployeeId) {
        out.employee_id = doc.employee_id;
    } else {
        // Evita referencias rotas entre DBs: el login puede auto-vincular employee_id por DNI.
        out.employee_id = (doc.role === 'employee' || doc.role === 'store_coordinator') ? null : (doc.employee_id || null);
    }

    return out;
}

function sameValue(a, b) {
    // Comparación simple y estable para strings/booleans/null
    if (a === b) return true;
    if (a === undefined && b === null) return true;
    if (a === null && b === undefined) return true;
    return String(a) === String(b);
}

function needsUpdate(source, target) {
    const keys = ['password', 'name', 'email', 'role', 'mustChangePassword', 'employee_id'];
    for (const k of keys) {
        const a = source[k];
        const b = target ? target[k] : undefined;
        if (k === 'mustChangePassword') {
            if (Boolean(a) !== Boolean(b)) return true;
        } else if (!sameValue(a, b)) {
            return true;
        }
    }
    return false;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const sourceDbName = String(args.source || process.env.MONGO_SOURCE_DB || 'test');
    const targetDbName = String(args.target || process.env.MONGO_TARGET_DB || 'recursos_humanos');
    const dryRun = toBool(args['dry-run'], true);
    const keepEmployeeId = toBool(args['keep-employee-id'], false);

    if (!process.env.MONGODB_URI) {
        console.error('❌ MONGODB_URI no está definida.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const client = mongoose.connection.getClient();

    const srcDb = client.db(sourceDbName);
    const dstDb = client.db(targetDbName);

    const srcUsersCol = srcDb.collection('users');
    const dstUsersCol = dstDb.collection('users');

    const srcUsers = await srcUsersCol.find({}).project({
        username: 1,
        password: 1,
        name: 1,
        email: 1,
        role: 1,
        employee_id: 1,
        mustChangePassword: 1
    }).toArray();

    const dstUsers = await dstUsersCol.find({}).project({
        username: 1,
        password: 1,
        name: 1,
        email: 1,
        role: 1,
        employee_id: 1,
        mustChangePassword: 1
    }).toArray();

    const dstMap = new Map(dstUsers.map(u => [String(u.username), u]));

    let willUpdate = 0;
    let willInsert = 0;
    let skipped = 0;

    const updateOps = [];

    for (const src of srcUsers) {
        const username = String(src.username);
        if (!username) continue;

        const target = dstMap.get(username);
        const picked = pickUserFields(src, { keepEmployeeId });

        if (!target) {
            willInsert += 1;
            updateOps.push({
                updateOne: {
                    filter: { username },
                    update: { $set: picked },
                    upsert: true
                }
            });
            continue;
        }

        const pickedTarget = pickUserFields(target, { keepEmployeeId: true });
        if (needsUpdate(picked, pickedTarget)) {
            willUpdate += 1;
            updateOps.push({
                updateOne: {
                    filter: { username },
                    update: { $set: picked },
                    upsert: false
                }
            });
        } else {
            skipped += 1;
        }
    }

    console.log('==========================================');
    console.log('🔁 Sync users entre MongoDB DBs');
    console.log('==========================================');
    console.log('SOURCE DB:', sourceDbName);
    console.log('TARGET DB:', targetDbName);
    console.log('dry-run:', dryRun);
    console.log('keep-employee-id:', keepEmployeeId);
    console.log('SOURCE users:', srcUsers.length);
    console.log('TARGET users:', dstUsers.length);
    console.log('willInsert:', willInsert);
    console.log('willUpdate:', willUpdate);
    console.log('skipped:', skipped);

    if (dryRun) {
        console.log('\n✅ Dry-run: no se aplicaron cambios.');
        return;
    }

    if (updateOps.length === 0) {
        console.log('\nℹ️ No hay cambios que aplicar.');
        return;
    }

    const res = await dstUsersCol.bulkWrite(updateOps, { ordered: false });
    console.log('\n✅ Cambios aplicados');
    console.log({
        inserted: res.upsertedCount,
        matched: res.matchedCount,
        modified: res.modifiedCount
    });
}

main()
    .catch((e) => {
        console.error('❌ Error:', e && e.message ? e.message : e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
