const sqlite3 = require('sqlite3').verbose();
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

// Modelos de MongoDB
const Employee = require('../src/models/Employee');
const User = require('../src/models/User');
const Vacation = require('../src/models/Vacation');
const Absence = require('../src/models/Absence');
const Attendance = require('../src/models/Attendance');

const dbPath = process.env.DB_PATH || './data/employees.db';
const sqliteDb = new sqlite3.Database(dbPath);

async function migrate() {
    try {
        console.log('--- Iniciando Migración a MongoDB ---');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Conectado a MongoDB Atlas');

        // Mapeo de IDs (SQLite ID -> MongoDB _id)
        const employeeMap = {};
        const userMap = {};

        // 1. Migrar Empleados
        console.log('Migrando Empleados...');
        const employees = await all(sqliteDb, 'SELECT * FROM employees');
        for (const emp of employees) {
            const newEmp = await Employee.findOneAndUpdate(
                { dni: emp.dni },
                {
                    full_name: emp.full_name,
                    dni: emp.dni,
                    phone: emp.phone,
                    email: emp.email,
                    position: emp.position,
                    location: emp.location,
                    convention: emp.convention,
                    status: emp.status,
                    hire_date: emp.hire_date,
                    termination_date: emp.termination_date,
                    salary: emp.salary,
                    notes: emp.notes
                },
                { upsert: true, new: true }
            );
            employeeMap[emp.id] = newEmp._id;
        }
        console.log(`✓ ${employees.length} empleados procesados`);

        // 2. Migrar Usuarios
        console.log('Migrando Usuarios...');
        const users = await all(sqliteDb, 'SELECT * FROM users');
        for (const u of users) {
            const newUser = await User.findOneAndUpdate(
                { username: u.username },
                {
                    username: u.username,
                    password: u.password,
                    name: u.name,
                    email: u.email,
                    role: u.role || 'admin',
                    employee_id: u.employee_id ? employeeMap[u.employee_id] : null
                },
                { upsert: true, new: true }
            );
            userMap[u.id] = newUser._id;
        }
        console.log(`✓ ${users.length} usuarios procesados`);

        // 3. Migrar Vacaciones
        console.log('Migrando Vacaciones...');
        const vacations = await all(sqliteDb, 'SELECT * FROM vacations');
        for (const v of vacations) {
            await Vacation.create({
                employee_id: employeeMap[v.employee_id],
                start_date: v.start_date,
                end_date: v.end_date,
                days: v.days,
                type: v.type,
                status: v.status,
                reason: v.reason,
                approved_by: v.approved_by ? userMap[v.approved_by] : null,
                approved_date: v.approved_date
            });
        }
        console.log(`✓ ${vacations.length} registros de vacaciones migrados`);

        // 4. Migrar Bajas
        console.log('Migrando Bajas...');
        const absences = await all(sqliteDb, 'SELECT * FROM absences');
        for (const a of absences) {
            await Absence.create({
                employee_id: employeeMap[a.employee_id],
                start_date: a.start_date,
                end_date: a.end_date,
                type: a.type,
                reason: a.reason,
                medical_certificate: !!a.medical_certificate,
                status: a.status,
                notes: a.notes
            });
        }
        console.log(`✓ ${absences.length} bajas migradas`);

        // 5. Migrar Asistencia
        console.log('Migrando Registros de Asistencia...');
        const attendance = await all(sqliteDb, 'SELECT * FROM attendance');
        for (const att of attendance) {
            await Attendance.create({
                employee_id: employeeMap[att.employee_id],
                type: att.type,
                timestamp: att.timestamp,
                latitude: att.latitude,
                longitude: att.longitude,
                device_info: att.device_info,
                notes: att.notes,
                ip_address: att.ip_address
            });
        }
        console.log(`✓ ${attendance.length} registros de asistencia migrados`);

        console.log('\n--- Migración Finalizada con Éxito ---');
        process.exit(0);

    } catch (error) {
        console.error('CRITICAL ERROR DURING MIGRATION:', error);
        process.exit(1);
    }
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

migrate();
