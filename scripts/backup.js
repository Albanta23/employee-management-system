const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './data/employees.db';
const BACKUP_DIR = './backups';

function createBackup() {
    console.log('\n===========================================');
    console.log('💾 CREANDO BACKUP DE LA BASE DE DATOS');
    console.log('===========================================\n');

    try {
        // Crear directorio de backups si no existe
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
            console.log('✓ Directorio de backups creado');
        }

        // Verificar que la base de datos existe
        if (!fs.existsSync(DB_PATH)) {
            console.log('❌ Error: No se encontró la base de datos en:', DB_PATH);
            process.exit(1);
        }

        // Generar nombre de backup con timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
        const backupName = `employees-backup-${timestamp}.db`;
        const backupPath = path.join(BACKUP_DIR, backupName);

        // Copiar la base de datos
        fs.copyFileSync(DB_PATH, backupPath);

        const stats = fs.statSync(backupPath);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log('✅ Backup creado exitosamente');
        console.log('==========================================');
        console.log('Archivo:', backupName);
        console.log('Ubicación:', path.resolve(backupPath));
        console.log('Tamaño:', sizeInMB, 'MB');
        console.log('Fecha:', new Date().toLocaleString('es-ES'));
        console.log('==========================================\n');

        // Listar backups existentes
        const backups = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.db'))
            .sort()
            .reverse();

        console.log(`📁 Total de backups: ${backups.length}`);
        console.log('\nÚltimos 5 backups:');
        backups.slice(0, 5).forEach((backup, index) => {
            const backupStats = fs.statSync(path.join(BACKUP_DIR, backup));
            const date = new Date(backupStats.mtime).toLocaleString('es-ES');
            console.log(`  ${index + 1}. ${backup} (${date})`);
        });

        // Advertencia si hay muchos backups
        if (backups.length > 30) {
            console.log(`\n⚠️  Advertencia: Tienes ${backups.length} backups.`);
            console.log('   Considera eliminar los más antiguos para liberar espacio.');
        }

        console.log('\n✅ Proceso completado\n');

    } catch (error) {
        console.error('\n❌ Error al crear backup:', error.message);
        process.exit(1);
    }
}

createBackup();
