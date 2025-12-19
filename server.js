const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initializeDatabase } = require('./src/database/db');
const authRoutes = require('./src/routes/auth.routes');
const employeesRoutes = require('./src/routes/employees.routes');
const vacationsRoutes = require('./src/routes/vacations.routes');
const absencesRoutes = require('./src/routes/absences.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/vacations', vacationsRoutes);
app.use('/api/absences', absencesRoutes);

// Ruta raíz - redirigir al login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar base de datos y arrancar servidor
initializeDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log('\n========================================');
            console.log('🚀 Servidor iniciado correctamente');
            console.log(`📍 URL: http://localhost:${PORT}`);
            console.log('========================================');
            console.log('\n👤 Credenciales por defecto:');
            console.log('   Usuario: admin');
            console.log('   Contraseña: admin123');
            console.log('========================================\n');
        });
    })
    .catch(err => {
        console.error('Error al inicializar la base de datos:', err);
        process.exit(1);
    });

module.exports = app;
