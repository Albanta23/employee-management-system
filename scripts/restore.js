require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const connectDB = require('../src/database/mongo');

const DB_PATH = process.env.DB_PATH || './data/employees.db';
const BACKUP_DIR = process.env.BACKUP_DIR || './backups';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

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

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const s = fs.createReadStream(filePath);
        s.on('error', reject);
        s.on('data', (chunk) => hash.update(chunk));
        s.on('end', () => resolve(hash.digest('hex')));
    });
}

async function loadMongooseModels() {
    const modelsDir = path.join(__dirname, '..', 'src', 'models');
    if (!fs.existsSync(modelsDir)) return;
    const files = fs.readdirSync(modelsDir)
        .filter(f => f.endsWith('.js'))
        .sort();
    for (const f of files) {
        require(path.join(modelsDir, f));
    }
}

function listMongoBackups() {
    const mongoDir = path.join(BACKUP_DIR, 'mongo');
    if (!fs.existsSync(mongoDir)) return [];
    return fs.readdirSync(mongoDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .reverse();
}

function listLegacySqliteBackups() {
    // Compatibilidad: backups antiguos tipo ./backups/*.db
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.db'))
        .sort()
        .reverse();
}

function listSqliteFolderBackups() {
    const sqliteDir = path.join(BACKUP_DIR, 'sqlite');
    if (!fs.existsSync(sqliteDir)) return [];
    return fs.readdirSync(sqliteDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .reverse();
}

async function verifyMongoBackupFolder(folderPath) {
    const checksumsPath = path.join(folderPath, 'checksums.json');
    const manifestPath = path.join(folderPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error('No se encontró manifest.json en el backup');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!fs.existsSync(checksumsPath)) {
        return { ok: true, mode: 'no-checksums', manifest };
    }

    const checksums = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'));
    if (!checksums || !Array.isArray(checksums.files)) {
        throw new Error('checksums.json inválido');
    }

    const expectedManifestHash = checksums.manifest && checksums.manifest.sha256 ? checksums.manifest.sha256 : null;
    if (expectedManifestHash) {
        const actual = await sha256File(manifestPath);
        if (actual !== expectedManifestHash) {
            throw new Error('El sha256 de manifest.json no coincide');
        }
    }

    for (const f of checksums.files) {
        const fp = path.join(folderPath, f.file);
        if (!fs.existsSync(fp)) throw new Error(`Falta el fichero ${f.file}`);
        const actual = await sha256File(fp);
        if (actual !== f.sha256) {
            throw new Error(`Checksum no coincide para ${f.file}`);
        }
    }

    return { ok: true, mode: 'checksums', manifest };
}

async function restoreMongoFromFolder(folderPath, { safetyBackup = true }) {
    await connectDB();
    await loadMongooseModels();

    const mongoose = require('mongoose');
    const manifestPath = path.join(folderPath, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || manifest.type !== 'mongo') {
        throw new Error('Backup no es de tipo mongo');
    }

    const modelEntries = Array.isArray(manifest.models) ? manifest.models : [];
    const modelNames = modelEntries.map(m => m.name).filter(Boolean);
    if (modelNames.length === 0) {
        throw new Error('manifest.models vacío; no hay nada que restaurar');
    }

    if (safetyBackup) {
        console.log('\n→ Creando backup de seguridad (Mongo) antes de restaurar...');
        const { spawnSync } = require('child_process');
        const res = spawnSync(process.execPath, [path.join(__dirname, 'backup.js'), '--type=mongo', '--keep=30', '--verify=true'], { stdio: 'inherit' });
        if (res.status !== 0) {
            throw new Error('No se pudo crear el backup de seguridad previo (abortando)');
        }
    }

    console.log('\n→ Restaurando datos en MongoDB...');
    for (const modelName of modelNames) {
        const filePath = path.join(folderPath, `${modelName}.jsonl`);
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  Saltando ${modelName}: falta ${modelName}.jsonl`);
            continue;
        }

        const Model = mongoose.model(modelName);
        console.log(`  - ${modelName}: limpiando colección...`);
        await Model.deleteMany({});

        console.log(`  - ${modelName}: importando...`);
        const rs = fs.createReadStream(filePath, { encoding: 'utf8' });
        let buffer = '';
        let batch = [];
        let imported = 0;

        const flush = async () => {
            if (batch.length === 0) return;
            // ordered:false permite seguir si un doc falla por duplicado/etc
            await Model.insertMany(batch, { ordered: false });
            imported += batch.length;
            batch = [];
        };

        for await (const chunk of rs) {
            buffer += chunk;
            let idx;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                const trimmed = line.trim();
                if (!trimmed) continue;
                batch.push(JSON.parse(trimmed));
                if (batch.length >= 1000) {
                    await flush();
                }
            }
        }

        if (buffer.trim()) {
            batch.push(JSON.parse(buffer.trim()));
        }

        await flush();
        console.log(`    ✓ ${modelName}: ${imported} documentos`);
    }

    console.log('\n✅ Restauración MongoDB completada');
}

async function restoreBackup() {
    console.log('\n===========================================');
    console.log('♻️  RESTAURAR BACKUP DE BASE DE DATOS');
    console.log('===========================================\n');

    try {
        const args = parseArgs(process.argv.slice(2));
        const typeArg = args.type ? String(args.type) : null;
        const type = typeArg || (process.env.MONGODB_URI ? 'mongo' : 'sqlite');
        const noSafety = args['no-safety'] === true || args['no-safety'] === 'true';
        const doVerify = args.verify === true || args.verify === 'true';

        if (!fs.existsSync(BACKUP_DIR)) {
            console.log('❌ Error: No se encontró el directorio de backups');
            process.exit(1);
        }

        if (type === 'mongo') {
            const backups = listMongoBackups();
            if (backups.length === 0) {
                console.log('❌ No hay backups Mongo disponibles en:', path.join(BACKUP_DIR, 'mongo'));
                process.exit(1);
            }

            const forcedFrom = args.from ? String(args.from) : null;
            const yes = args.yes === true || args.yes === 'true';

            let selectedBackup;
            if (forcedFrom) {
                if (!backups.includes(forcedFrom)) {
                    console.log('❌ Backup no encontrado:', forcedFrom);
                    console.log('   Disponibles:', backups.slice(0, 5).join(', ') + (backups.length > 5 ? '…' : ''));
                    process.exit(1);
                }
                selectedBackup = forcedFrom;
            } else {
                console.log('Backups Mongo disponibles:\n');
                backups.forEach((b, idx) => {
                    const folder = path.join(BACKUP_DIR, 'mongo', b);
                    const manifestPath = path.join(folder, 'manifest.json');
                    let meta = '';
                    try {
                        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                        meta = m && m.createdAt ? ` | ${new Date(m.createdAt).toLocaleString('es-ES')}` : '';
                    } catch (_) { }
                    console.log(`  ${idx + 1}. ${b}${meta}`);
                });

                const selection = await question(`\nSelecciona el número del backup a restaurar (1-${backups.length}): `);
                const selectedIndex = parseInt(selection) - 1;
                if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= backups.length) {
                    console.log('\n❌ Selección inválida');
                    rl.close();
                    process.exit(1);
                }
                selectedBackup = backups[selectedIndex];
            }

            const folderPath = path.join(BACKUP_DIR, 'mongo', selectedBackup);

            console.log(`\n⚠️  ADVERTENCIA: Esto borrará y restaurará las colecciones (MongoDB).`);
            console.log(`    ${noSafety ? 'NO ' : ''}Se creará un backup de seguridad antes de restaurar.\n`);

            if (doVerify) {
                console.log('🔍 Verificando integridad del backup...');
                const v = await verifyMongoBackupFolder(folderPath);
                console.log(`✓ Verificación OK (${v.mode})`);
            }

            const confirm = yes ? 'RESTAURAR MONGO' : await question('Para confirmar, escribe: RESTAURAR MONGO\n> ');
            if (confirm !== 'RESTAURAR MONGO') {
                console.log('\n❌ Operación cancelada');
                rl.close();
                process.exit(0);
            }

            await restoreMongoFromFolder(folderPath, { safetyBackup: !noSafety });

            console.log('\n⚠️  Si el servidor está ejecutándose, reinícialo para asegurar cachés limpias.\n');
            rl.close();
            process.exit(0);
        }

        // SQLITE: soporta backups en carpeta (nuevo) y backups legacy .db (antiguo)
        const folderBackups = listSqliteFolderBackups();
        const legacyBackups = listLegacySqliteBackups();

        const options = [];
        for (const b of folderBackups) options.push({ kind: 'folder', label: `sqlite/${b}`, value: path.join(BACKUP_DIR, 'sqlite', b, 'employees.db') });
        for (const b of legacyBackups) options.push({ kind: 'legacy', label: b, value: path.join(BACKUP_DIR, b) });

        if (options.length === 0) {
            console.log('❌ No hay backups SQLite disponibles');
            process.exit(1);
        }

        console.log('Backups SQLite disponibles:\n');
        options.forEach((opt, index) => {
            const backupPath = opt.value;
            const stats = fs.existsSync(backupPath) ? fs.statSync(backupPath) : null;
            const date = stats ? new Date(stats.mtime).toLocaleString('es-ES') : 'N/A';
            const sizeInMB = stats ? (stats.size / (1024 * 1024)).toFixed(2) : 'N/A';
            console.log(`  ${index + 1}. ${opt.label}`);
            console.log(`     Fecha: ${date} | Tamaño: ${sizeInMB} MB\n`);
        });

        const selection = await question(`Selecciona el número del backup a restaurar (1-${options.length}): `);
        const selectedIndex = parseInt(selection) - 1;
        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
            console.log('\n❌ Selección inválida');
            rl.close();
            process.exit(1);
        }

        const selected = options[selectedIndex];
        const backupPath = selected.value;

        console.log(`\n⚠️  ADVERTENCIA: Esta acción sobrescribirá la base de datos SQLite actual`);
        console.log(`    ${noSafety ? 'NO ' : ''}Se creará un backup de seguridad antes de restaurar\n`);

        const confirm = await question('¿Estás seguro? (escribe "SI" para confirmar): ');
        if (confirm !== 'SI') {
            console.log('\n❌ Operación cancelada');
            rl.close();
            process.exit(0);
        }

        if (!noSafety && fs.existsSync(DB_PATH)) {
            const safetyBackupName = `employees-pre-restore-${Date.now()}.db`;
            const safetyBackupPath = path.join(BACKUP_DIR, safetyBackupName);
            fs.copyFileSync(DB_PATH, safetyBackupPath);
            console.log('\n✓ Backup de seguridad creado:', safetyBackupName);
        }

        fs.copyFileSync(backupPath, DB_PATH);

        console.log('\n✅ Base de datos restaurada exitosamente');
        console.log('==========================================');
        console.log('Backup restaurado:', selected.label);
        console.log('Base de datos:', DB_PATH);
        console.log('==========================================\n');
        console.log('⚠️  Reinicia el servidor para que los cambios surtan efecto\n');

    } catch (error) {
        console.error('\n❌ Error al restaurar backup:', error.message);
        process.exit(1);
    }

    rl.close();
    process.exit(0);
}

restoreBackup();
