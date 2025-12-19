const XLSX = require('xlsx');
const path = require('path');
const bcrypt = require('bcrypt');
const { db, initializeDatabase, dbRun } = require('./db');

async function importEmployeesFromExcel() {
    try {
        console.log('🔄 Importando trabajadores desde Excel...');
        
        // Inicializar la base de datos primero
        await initializeDatabase();
        
        // Leer el archivo Excel
        const excelPath = path.join(__dirname, '../../TRABAJADORES.xlsx');
        const workbook = XLSX.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convertir a JSON
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // La primera fila contiene los datos del primer empleado
        // Procesar cada fila
        let imported = 0;
        let errors = 0;
        
        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            
            // Saltar filas vacías
            if (!row || row.length === 0 || !row[0]) continue;
            
            try {
                const employee = {
                    full_name: row[0] || '',
                    dni: row[3] || '',
                    phone: row[4] ? String(row[4]) : '',
                    email: row[5] || null,
                    position: row[7] || 'Sin especificar',
                    location: row[9] || 'Sin especificar',
                    status: 'active',
                    hire_date: new Date().toISOString().split('T')[0]
                };
                
                // Validar datos mínimos
                if (!employee.full_name || !employee.dni) {
                    console.log(`⚠ Fila ${i + 1}: Datos incompletos, omitiendo...`);
                    continue;
                }
                
                // Insertar en la base de datos
                await dbRun(
                    `INSERT INTO employees (full_name, dni, phone, email, position, location, status, hire_date)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        employee.full_name,
                        employee.dni,
                        employee.phone,
                        employee.email,
                        employee.position,
                        employee.location,
                        employee.status,
                        employee.hire_date
                    ]
                );
                
                imported++;
                console.log(`✓ Importado: ${employee.full_name}`);
                
            } catch (err) {
                errors++;
                console.error(`✗ Error en fila ${i + 1}:`, err.message);
            }
        }
        
        // Crear usuario admin si no existe
        try {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await dbRun(
                `INSERT OR IGNORE INTO users (username, password, name, email)
                 VALUES (?, ?, ?, ?)`,
                ['admin', hashedPassword, 'Administrador', 'admin@example.com']
            );
            console.log('✓ Usuario administrador creado');
        } catch (err) {
            console.log('ℹ Usuario administrador ya existe');
        }
        
        console.log('\n========================');
        console.log(`✓ Importación completada`);
        console.log(`  Trabajadores importados: ${imported}`);
        console.log(`  Errores: ${errors}`);
        console.log('========================\n');
        
        process.exit(0);
        
    } catch (error) {
        console.error('Error durante la importación:', error);
        process.exit(1);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    importEmployeesFromExcel();
}

module.exports = { importEmployeesFromExcel };
