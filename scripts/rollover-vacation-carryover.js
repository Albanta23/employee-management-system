/*
 * Rollover de vacaciones: pasa los días no consumidos del año anterior
 * al campo Employee.vacation_carryover_days (Mongo).
 *
 * Uso:
 *   node scripts/rollover-vacation-carryover.js --year=2025
 *   node scripts/rollover-vacation-carryover.js --year=2025 --dry-run
 *   node scripts/rollover-vacation-carryover.js --year=2025 --force
 */

const connectDB = require('../src/database/mongo');
const { runVacationRollover } = require('../src/utils/vacationRollover');

function parseArgs(argv) {
    const out = { year: null, dryRun: false, force: false };

    const args = argv.slice(2);
    for (let i = 0; i < args.length; i += 1) {
        const raw = args[i];
        const [k, v] = raw.split('=');

        if (k === '--year') {
            // Soporta: --year=2025 y --year 2025
            const value = v != null ? v : args[i + 1];
            if (v == null) i += 1;
            out.year = Number(value);
            continue;
        }

        if (k === '--dry-run') {
            out.dryRun = true;
            continue;
        }

        if (k === '--force') {
            out.force = true;
            continue;
        }
    }
    return out;
}

async function main() {
    const { year, dryRun, force } = parseArgs(process.argv);
    const targetYear = Number.isFinite(year) ? year : (new Date().getFullYear() - 1);

    await connectDB();

    const result = await runVacationRollover({
        targetYear,
        dryRun,
        force,
        actor: { user_id: null, username: 'system', role: 'system' }
    });

    if (result.skipped) {
        console.log(result.message);
        process.exit(0);
    }

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Rollover ${targetYear}: empleados actualizados=${result.updatedEmployees}, días añadidos=${result.totalAddedDays}`);
    process.exit(0);
}

main().catch((e) => {
    console.error('Error en rollover-vacation-carryover:', e);
    process.exit(1);
});
