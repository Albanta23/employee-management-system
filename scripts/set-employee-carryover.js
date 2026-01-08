/*
 * Ajuste manual de carryover de vacaciones por empleado.
 *
 * Uso:
 *   node scripts/set-employee-carryover.js --name="ALICIA FERNANDEZ MARCOS" --days=7
 *   node scripts/set-employee-carryover.js --name="ALICIA" --days=7   (si hay varias coincidencias, no actualiza)
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/database/mongo');
const Employee = require('../src/models/Employee');
const AuditLog = require('../src/models/AuditLog');

function parseArgs(argv) {
  const out = { name: '', days: null };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    const [k, v] = raw.split('=');

    if (k === '--name') {
      const value = v != null ? v : args[i + 1];
      if (v == null) i += 1;
      out.name = String(value || '').trim();
      continue;
    }

    if (k === '--days') {
      const value = v != null ? v : args[i + 1];
      if (v == null) i += 1;
      out.days = Number(value);
      continue;
    }
  }
  return out;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function shutdown(code) {
  try {
    await mongoose.disconnect();
  } catch (_) {
    // Ignorar
  }
  process.exit(code);
}

async function main() {
  const { name, days } = parseArgs(process.argv);
  if (!name) {
    console.error('Falta --name');
    await shutdown(2);
  }
  if (!Number.isFinite(days) || days < 0) {
    console.error('Valor inválido en --days (debe ser número >= 0)');
    await shutdown(2);
  }

  await connectDB();

  // Primero intentamos match exacto (case-insensitive)
  const exact = await Employee.find({ full_name: new RegExp('^' + escapeRegex(name) + '$', 'i') })
    .select('_id full_name location status vacation_carryover_days')
    .lean();

  let matches = exact;
  if (!matches.length) {
    // Si no hay exacto, hacemos búsqueda parcial
    matches = await Employee.find({ full_name: new RegExp(escapeRegex(name), 'i') })
      .select('_id full_name location status vacation_carryover_days')
      .limit(20)
      .lean();
  }

  if (!matches.length) {
    console.log('No se encontró ningún empleado con:', name);
    await shutdown(3);
  }

  if (matches.length > 1) {
    console.log('Hay más de una coincidencia. No actualizo para evitar errores. Coincidencias:');
    for (const m of matches) {
      console.log('-', { _id: String(m._id), full_name: m.full_name, location: m.location, status: m.status, vacation_carryover_days: Number(m.vacation_carryover_days || 0) });
    }
    await shutdown(4);
  }

  const emp = matches[0];
  const before = Number(emp.vacation_carryover_days || 0);
  const after = days;

  if (before === after) {
    console.log('Sin cambios: ya estaba en', after, '-', { _id: String(emp._id), full_name: emp.full_name });
    await shutdown(0);
  }

  await Employee.updateOne({ _id: emp._id }, { $set: { vacation_carryover_days: after } });

  await AuditLog.create({
    actor: { user_id: null, username: 'system', role: 'system' },
    action: 'employee.carryover.set',
    entity: { type: 'employee', id: String(emp._id) },
    employee: { id: String(emp._id), location: String(emp.location || '') },
    before: { vacation_carryover_days: before },
    after: { vacation_carryover_days: after },
    meta: { reason: 'Ajuste manual carryover (días pendientes de 2025)' }
  });

  console.log('Actualizado OK:', { _id: String(emp._id), full_name: emp.full_name, location: emp.location, vacation_carryover_days: { before, after } });
  await shutdown(0);
}

main().catch((e) => {
  console.error('Error:', e);
  shutdown(1);
});
