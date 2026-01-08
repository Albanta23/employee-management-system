require('dotenv').config();

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

// Configuración por entorno
// VACATION_ROLLOVER_CRON: expresión cron (por defecto: 00:10 del 1 de enero)
// VACATION_ROLLOVER_FORCE: true|false (por defecto false)
// VACATION_ROLLOVER_DRY_RUN: true|false (por defecto false)
// VACATION_ROLLOVER_RUN_ON_START: true|false (por defecto false)

const schedule = process.env.VACATION_ROLLOVER_CRON || '10 0 1 1 *';
const force = (process.env.VACATION_ROLLOVER_FORCE || 'false').toLowerCase() === 'true';
const dryRun = (process.env.VACATION_ROLLOVER_DRY_RUN || 'false').toLowerCase() === 'true';

function buildArgs() {
  const args = [path.join(__dirname, 'rollover-vacation-carryover.js')];
  if (dryRun) args.push('--dry-run');
  if (force) args.push('--force');
  return args;
}

function runRollover() {
  const node = process.execPath;
  const args = buildArgs();
  console.log(`\n[vacation-rollover-scheduler] Ejecutando rollover: ${node} ${args.join(' ')}`);

  const child = spawn(node, args, {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[vacation-rollover-scheduler] ✅ Rollover completado');
    } else {
      console.error(`[vacation-rollover-scheduler] ❌ Rollover falló (exit=${code})`);
    }
  });
}

console.log('[vacation-rollover-scheduler] Iniciado');
console.log('[vacation-rollover-scheduler] Cron:', schedule);

if (!cron.validate(schedule)) {
  console.error('[vacation-rollover-scheduler] Expresión cron inválida:', schedule);
  process.exit(1);
}

// Ejecutar una vez al arrancar si VACATION_ROLLOVER_RUN_ON_START=true
if ((process.env.VACATION_ROLLOVER_RUN_ON_START || 'false').toLowerCase() === 'true') {
  runRollover();
}

cron.schedule(schedule, runRollover);
