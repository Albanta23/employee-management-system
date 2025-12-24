require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const connectDB = require('../src/database/mongo');

const DEFAULT_SQLITE_DB_PATH = process.env.DB_PATH || './data/employees.db';
const DEFAULT_BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const DEFAULT_KEEP = Number.isFinite(Number(process.env.BACKUP_KEEP)) ? Number(process.env.BACKUP_KEEP) : 30;

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

function toSafeTimestamp(d = new Date()) {
    // YYYY-MM-DDTHH-mm-ssZ
    return d.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
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

function listBackupFolders(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .reverse();
}

function rotateBackups(typedDir, keep) {
    const folders = listBackupFolders(typedDir);
    const toDelete = folders.slice(keep);
    for (const name of toDelete) {
        const full = path.join(typedDir, name);
        try {
            fs.rmSync(full, { recursive: true, force: true });
        } catch (e) {
            console.warn('⚠️  No se pudo borrar backup antiguo:', full, e && e.message ? e.message : e);
        }
    }
    return { total: folders.length, deleted: toDelete.length };
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

async function backupMongo({ backupDir, keep, verify }) {
    console.log('\n===========================================');
    console.log('💾 CREANDO BACKUP (MongoDB)');
    console.log('===========================================\n');

    await connectDB();
    await loadMongooseModels();

    const mongoose = require('mongoose');
    const modelNames = mongoose.modelNames().slice().sort();
    if (modelNames.length === 0) {
        throw new Error('No se encontraron modelos de Mongoose para exportar (src/models).');
    }

    const typedDir = path.join(backupDir, 'mongo');
    ensureDir(typedDir);

    const backupName = toSafeTimestamp(new Date());
    const outDir = path.join(typedDir, backupName);
    ensureDir(outDir);

    const manifest = {
        type: 'mongo',
        createdAt: new Date().toISOString(),
        models: [],
        files: [],
        app: {
            name: 'employee-management-system',
            version: (() => {
                try {
                    const pkg = require('../package.json');
                    return pkg && pkg.version ? pkg.version : null;
                } catch (_) {
                    return null;
                }
            })()
        }
    };

    for (const modelName of modelNames) {
        const Model = mongoose.model(modelName);
        const fileBase = `${modelName}.jsonl`;
        const filePath = path.join(outDir, fileBase);

        console.log(`→ Exportando ${modelName}...`);

        let count = 0;
        const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
        const cursor = Model.find({}).lean().cursor();
        for await (const doc of cursor) {
            ws.write(JSON.stringify(doc) + '\n');
            count += 1;
        }
        await new Promise((resolve, reject) => {
            ws.end(() => resolve());
            ws.on('error', reject);
        });

        const stats = fs.statSync(filePath);
        const entry = {
            model: modelName,
            collection: Model.collection && Model.collection.name ? Model.collection.name : null,
            count,
            file: fileBase,
            bytes: stats.size
        };
        manifest.models.push({ name: modelName, collection: entry.collection, count });
        manifest.files.push(entry);
    }

    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    if (verify) {
        console.log('\n🔍 Verificando integridad (sha256)...');
        const fileHashes = [];
        for (const f of manifest.files) {
            const fp = path.join(outDir, f.file);
            const hash = await sha256File(fp);
            fileHashes.push({ file: f.file, sha256: hash });
        }
        const manifestHash = await sha256File(manifestPath);
        fs.writeFileSync(path.join(outDir, 'checksums.json'), JSON.stringify({ files: fileHashes, manifest: { file: 'manifest.json', sha256: manifestHash } }, null, 2), 'utf8');
        console.log('✓ Checksums generados');
    }

    const rotation = rotateBackups(typedDir, keep);

    console.log('\n✅ Backup creado exitosamente');
    console.log('==========================================');
    console.log('Tipo:', 'MongoDB');
    console.log('Carpeta:', path.resolve(outDir));
    console.log('Modelos:', manifest.models.length);
    console.log('Rotación:', `total=${rotation.total}, eliminados=${rotation.deleted}, keep=${keep}`);
    console.log('Fecha:', new Date().toLocaleString('es-ES'));
    console.log('==========================================\n');

    // Cerrar conexión para que el proceso termine limpio
    try {
        const mongoose = require('mongoose');
        await mongoose.disconnect();
    } catch (_) {
        // no-op
    }
}

async function backupSqlite({ backupDir, keep, dbPath }) {
    console.log('\n===========================================');
    console.log('💾 CREANDO BACKUP (SQLite)');
    console.log('===========================================\n');

    const typedDir = path.join(backupDir, 'sqlite');
    ensureDir(typedDir);

    if (!fs.existsSync(dbPath)) {
        throw new Error(`No se encontró la base de datos SQLite en: ${dbPath}`);
    }

    const backupName = toSafeTimestamp(new Date());
    const outDir = path.join(typedDir, backupName);
    ensureDir(outDir);

    const outFile = path.join(outDir, 'employees.db');
    fs.copyFileSync(dbPath, outFile);

    const stats = fs.statSync(outFile);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    const manifest = {
        type: 'sqlite',
        createdAt: new Date().toISOString(),
        dbPath: dbPath,
        file: 'employees.db',
        bytes: stats.size,
        sizeInMB
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const rotation = rotateBackups(typedDir, keep);

    console.log('✅ Backup creado exitosamente');
    console.log('==========================================');
    console.log('Tipo:', 'SQLite');
    console.log('Carpeta:', path.resolve(outDir));
    console.log('Tamaño:', sizeInMB, 'MB');
    console.log('Rotación:', `total=${rotation.total}, eliminados=${rotation.deleted}, keep=${keep}`);
    console.log('Fecha:', new Date().toLocaleString('es-ES'));
    console.log('==========================================\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const backupDir = String(args.dir || DEFAULT_BACKUP_DIR);
    const keep = Number.isFinite(Number(args.keep)) ? Number(args.keep) : DEFAULT_KEEP;
    const verify = args.verify === true || args.verify === 'true';

    // Auto: si hay MONGODB_URI -> mongo; si no, sqlite.
    const typeArg = args.type ? String(args.type) : null;
    let type = typeArg || (process.env.MONGODB_URI ? 'mongo' : 'sqlite');

    try {
        ensureDir(backupDir);

        if (!typeArg && type === 'sqlite' && !process.env.MONGODB_URI) {
            const candidateDb = String(args.db || DEFAULT_SQLITE_DB_PATH);
            if (!fs.existsSync(candidateDb)) {
                console.log('⚠️  No se detectó MONGODB_URI y tampoco existe la BD SQLite.');
                console.log('   - Si usas MongoDB: define MONGODB_URI (en .env o variables del sistema) o ejecuta: npm run backup:mongo');
                console.log('   - Si usas SQLite: crea el fichero o pasa --db=RUTA/AL/DB y ejecuta: npm run backup:sqlite');
                process.exit(1);
            }
        }

        if (type === 'mongo') {
            await backupMongo({ backupDir, keep, verify });
        } else if (type === 'sqlite') {
            const dbPath = String(args.db || DEFAULT_SQLITE_DB_PATH);
            await backupSqlite({ backupDir, keep, dbPath });
        } else {
            throw new Error(`Tipo no soportado: ${type}. Usa --type=mongo o --type=sqlite`);
        }
    } catch (error) {
        console.error('\n❌ Error al crear backup:', error && error.message ? error.message : error);
        process.exit(1);
    }
}

main();
