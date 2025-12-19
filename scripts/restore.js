const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DB_PATH = process.env.DB_PATH || './data/employees.db';
const BACKUP_DIR = './backups';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function restoreBackup() {
    console.log('\n===========================================');
    console.log('♻️  RESTAURAR BACKUP DE BASE DE DATOS');
    console.log('===========================================\n');

    try {
        // Verificar directorio de backups
        if (!fs.existsSync(BACKUP_DIR)) {
            console.log('❌ Error: No se encontró el directorio de backups');
            process.exit(1);
        }

        // Listar backups disponibles
        const backups = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.db'))
            .sort()
            .reverse();

        if (backups.length === 0) {
            console.log('❌ No hay backups disponibles');
            process.exit(1);
        }

        console.log('Backups disponibles:\n');
        backups.forEach((backup, index) => {
            const backupPath = path.join(BACKUP_DIR, backup);
            const stats = fs.statSync(backupPath);
            const date = new Date(stats.mtime).toLocaleString('es-ES');
            const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(`  ${index + 1}. ${backup}`);
            console.log(`     Fecha: ${date} | Tamaño: ${sizeInMB} MB\n`);
        });

        const selection = await question(`Selecciona el número del backup a restaurar (1-${backups.length}): `);
        const selectedIndex = parseInt(selection) - 1;

        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= backups.length) {
            console.log('\n❌ Selección inválida');
            rl.close();
            process.exit(1);
        }

        const selectedBackup = backups[selectedIndex];
        const backupPath = path.join(BACKUP_DIR, selectedBackup);

        console.log(`\n⚠️  ADVERTENCIA: Esta acción sobrescribirá la base de datos actual`);
        console.log(`    Se creará un backup de seguridad antes de restaurar\n`);

        const confirm = await question('¿Estás seguro? (escribe "SI" para confirmar): ');

        if (confirm !== 'SI') {
            console.log('\n❌ Operación cancelada');
            rl.close();
            process.exit(0);
        }

        // Crear backup de seguridad de la BD actual
        if (fs.existsSync(DB_PATH)) {
            const safetyBackupName = `employees-pre-restore-${Date.now()}.db`;
            const safetyBackupPath = path.join(BACKUP_DIR, safetyBackupName);
            fs.copyFileSync(DB_PATH, safetyBackupPath);
            console.log('\n✓ Backup de seguridad creado:', safetyBackupName);
        }

        // Restaurar desde backup
        fs.copyFileSync(backupPath, DB_PATH);

        console.log('\n✅ Base de datos restaurada exitosamente');
        console.log('==========================================');
        console.log('Backup restaurado:', selectedBackup);
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
