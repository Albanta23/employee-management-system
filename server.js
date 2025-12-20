const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const connectDB = require('./src/database/mongo');
const authRoutes = require('./src/routes/auth.routes');
const employeesRoutes = require('./src/routes/employees.routes');
const vacationsRoutes = require('./src/routes/vacations.routes');
const absencesRoutes = require('./src/routes/absences.routes');
const attendanceRoutes = require('./src/routes/attendance.routes');

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
app.use('/api/attendance', attendanceRoutes);

// Ruta raíz - redirigir al login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Conectar a MongoDB y arrancar servidor
connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log('\n========================================');
            console.log('🚀 Servidor con MongoDB iniciado');
            console.log(`📍 URL: http://localhost:${PORT}`);
            console.log('🌍 Base de Datos: MongoDB Atlas (Global)');
            console.log('========================================\n');
        });
    })
    .catch(err => {
        console.error('Error al conectar a MongoDB:', err);
        process.exit(1);
    });

module.exports = app;
