/*
  Backfill de vacation_year en solicitudes existentes.

  - Si ya tienen vacation_year, no se tocan.
  - Si el motivo contiene un año (YYYY), se usa ese.
  - Si no, se usa el año (UTC) de start_date.

  Uso:
    node scripts/backfill-vacation-year.js
*/

require('dotenv').config();

const connectDB = require('../src/database/mongo');
const Vacation = require('../src/models/Vacation');

function parseYearFromReason(reason) {
    const text = String(reason || '');
    const match = text.match(/\b(19\d{2}|20\d{2})\b/);
    if (!match) return null;
    const y = Number.parseInt(match[1], 10);
    if (!Number.isFinite(y) || y < 1970 || y > 3000) return null;
    return y;
}

function deriveYear(v) {
    const fromReason = parseYearFromReason(v.reason);
    if (fromReason) return fromReason;

    const s = v.start_date ? new Date(v.start_date) : null;
    if (s && !Number.isNaN(s.getTime())) return s.getUTCFullYear();

    return null;
}

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('ERROR: MONGODB_URI no está definida (revisa .env)');
        process.exit(1);
    }

    await connectDB();

    const cursor = Vacation.find({ $or: [{ vacation_year: { $exists: false } }, { vacation_year: null }] })
        .select('_id start_date reason vacation_year')
        .lean()
        .cursor();

    let scanned = 0;
    let updated = 0;
    let skipped = 0;

    for await (const v of cursor) {
        scanned++;
        const year = deriveYear(v);
        if (!year) {
            skipped++;
            continue;
        }

        await Vacation.updateOne({ _id: v._id }, { $set: { vacation_year: year } });
        updated++;
    }

    console.log(JSON.stringify({ scanned, updated, skipped }, null, 2));
    process.exit(0);
}

main().catch((err) => {
    console.error('ERROR backfill vacation_year:', err && err.message ? err.message : err);
    process.exit(1);
});
