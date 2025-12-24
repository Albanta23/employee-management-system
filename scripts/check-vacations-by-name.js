/*
  Uso:
    node scripts/check-vacations-by-name.js "Alicia Maria Fernandez Marcos"

  Nota:
    Script de diagnóstico para consultar vacaciones en MongoDB.
*/

require('dotenv').config();

const connectDB = require('../src/database/mongo');
const Employee = require('../src/models/Employee');
const Vacation = require('../src/models/Vacation');

function tokenizeName(input) {
    return String(input || '')
        .trim()
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);
}

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
    const nameQuery = process.argv.slice(2).join(' ').trim() || 'Alicia Maria Fernandez Marcos';
    const tokens = tokenizeName(nameQuery);

    if (!process.env.MONGODB_URI) {
        console.error('ERROR: MONGODB_URI no está definida (revisa .env)');
        process.exit(1);
    }

    await connectDB();

    const andClauses = tokens.map(t => ({ full_name: new RegExp(escapeRegex(t), 'i') }));
    const employeeQuery = andClauses.length ? { $and: andClauses } : {};

    const employees = await Employee.find(employeeQuery)
        .select('_id full_name dni location status annual_vacation_days hire_date termination_date')
        .lean();

    if (!employees.length) {
        console.log(`No se encontró ningún empleado que coincida con: "${nameQuery}"`);
        process.exit(0);
    }

    console.log(`Empleados encontrados (${employees.length}) para: "${nameQuery}"`);
    for (const emp of employees) {
        console.log('\n---');
        console.log(`Empleado: ${emp.full_name}`);
        console.log(`ID: ${emp._id}`);
        console.log(`DNI: ${emp.dni}`);
        console.log(`Centro: ${emp.location}`);
        console.log(`Estado: ${emp.status}`);
        console.log(`Vacaciones anuales: ${emp.annual_vacation_days}`);

        const vacations = await Vacation.find({ employee_id: emp._id })
            .sort({ start_date: -1, createdAt: -1 })
            .select('_id type vacation_year status start_date end_date days reason approved_by approved_date rejected_by rejected_date rejection_reason cancelled_by cancelled_date cancellation_reason revoked_by revoked_date revocation_reason createdAt updatedAt')
            .lean();

        console.log(`Vacaciones/Permisos encontrados: ${vacations.length}`);
        for (const v of vacations) {
            const sd = v.start_date ? new Date(v.start_date).toISOString().slice(0, 10) : '';
            const ed = v.end_date ? new Date(v.end_date).toISOString().slice(0, 10) : '';
            const vy = (v.vacation_year != null) ? String(v.vacation_year) : '-';
            console.log(`- ${sd} -> ${ed} | días=${v.days} | año=${vy} | tipo=${v.type || 'vacation'} | estado=${v.status || 'pending'} | id=${v._id}`);
            if (v.reason) console.log(`  motivo: ${v.reason}`);
            if (v.status === 'rejected' && v.rejection_reason) console.log(`  rechazo: ${v.rejection_reason}`);
            if (v.status === 'cancelled' && v.cancellation_reason) console.log(`  cancelación: ${v.cancellation_reason}`);
            if (v.status === 'revoked' && v.revocation_reason) console.log(`  revocación: ${v.revocation_reason}`);
        }
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('ERROR consultando vacaciones:', err && err.message ? err.message : err);
    process.exit(1);
});
