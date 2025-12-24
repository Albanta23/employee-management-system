require('dotenv').config();

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

// Configuración por entorno
// BACKUP_CRON: expresión cron (por defecto 03:00 todos los días)
// BACKUP_TYPE: mongo|sqlite (por defecto: auto)
// BACKUP_KEEP: número de backups a conservar (por defecto: 30)
// BACKUP_DIR: directorio base de backups (por defecto: ./backups)

const schedule = process.env.BACKUP_CRON || '0 3 * * *';
const backupType = process.env.BACKUP_TYPE || ''; // vacío => auto
const keep = process.env.BACKUP_KEEP || '';
const backupDir = process.env.BACKUP_DIR || '';
const verify = (process.env.BACKUP_VERIFY || 'true').toLowerCase() === 'true';

function buildArgs() {
  const args = [path.join(__dirname, 'backup.js')];
  if (backupType) args.push(`--type=${backupType}`);
  if (keep) args.push(`--keep=${keep}`);
  if (backupDir) args.push(`--dir=${backupDir}`);
  if (verify) args.push(`--verify=true`);
  return args;
}

function runBackup() {
  const node = process.execPath;
  const args = buildArgs();
  console.log(`\n[backup-scheduler] Ejecutando backup: ${node} ${args.join(' ')}`);

  const child = spawn(node, args, {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[backup-scheduler] ✅ Backup completado');
    } else {
      console.error(`[backup-scheduler] ❌ Backup falló (exit=${code})`);
    }
  });
}

console.log('[backup-scheduler] Iniciado');
console.log('[backup-scheduler] Cron:', schedule);

if (!cron.validate(schedule)) {
  console.error('[backup-scheduler] Expresión cron inválida:', schedule);
  process.exit(1);
}

// Ejecutar una vez al arrancar si BACKUP_RUN_ON_START=true
if ((process.env.BACKUP_RUN_ON_START || 'false').toLowerCase() === 'true') {
  runBackup();
}

cron.schedule(schedule, runBackup);
