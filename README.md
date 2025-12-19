# Sistema de Gestión de Trabajadores 👥

Sistema completo de gestión de recursos humanos con backend robusto, base de datos SQLite y dashboard interactivo moderno.

![Sistema de Gestión](system_working_demo_1766171756620.webp)

## 🚀 Características

### Backend API REST

- ✅ Node.js + Express con arquitectura modular
- ✅ Base de datos SQLite (portátil, sin configuración adicional)
- ✅ Autenticación JWT segura
- ✅ Endpoints CRUD completos para:
  - Trabajadores (empleados)
  - Vacaciones
  - Bajas médicas
  - Historial laboral

### Frontend Dashboard

- ✅ Diseño moderno con modo oscuro premium
- ✅ Glassmorphism y animaciones suaves
- ✅ Gráficos interactivos con Chart.js
- ✅ Diseño responsive (móvil, tablet, desktop)
- ✅ Búsqueda y filtros avanzados
- ✅ Gestión completa de empleados

### Datos Importados

- ✅ **49 trabajadores** importados automáticamente desde Excel
- ✅ Información completa: DNI, teléfono, email, puesto, ubicación
- ✅ Múltiples ubicaciones: FABRICA, MORADAS, SALAMANCA 2, TRES CRUCES, etc.

## 📦 Instalación

### Prerrequisitos

- Node.js 14 o superior
- NPM

### Pasos de Instalación

```bash
# 1. Las dependencias ya están instaladas
# Si necesitas reinstalar:
npm install

# 2. Los datos ya fueron importados
# Si necesitas reimportar:
npm run import-data

# 3. Iniciar el servidor
npm start
```

El servidor se iniciará en **http://localhost:3000**

## 🔐 Acceso al Sistema

**Credenciales por defecto:**

- **Usuario:** `admin`
- **Contraseña:** `admin123`

> ⚠️ **IMPORTANTE**: Cambia estas credenciales en producción por seguridad.

## 📖 Uso del Sistema

### 1. Dashboard Principal

- Visualiza estadísticas en tiempo real
- Gráficos de distribución por ubicación y puesto
- Accesos rápidos a funciones principales

### 2. Gestión de Trabajadores

- Lista completa con búsqueda y filtros
- Alta de nuevos empleados
- Edición de datos existentes
- Dar de baja trabajadores

### 3. Gestión de Vacaciones

- Crear solicitudes de vacaciones
- Aprobar o rechazar solicitudes
- Calendario de vacaciones
- Estadísticas de días disponibles

### 4. Gestión de Bajas Médicas

- Registrar bajas (médicas, maternidad, paternidad, accidente)
- Seguimiento de bajas activas
- Cerrar bajas completadas
- Registro de certificados médicos

## 🗂️ Estructura del Proyecto

````
kinetic-sunspot/
├── server.js                 # Servidor principal
├── package.json              # Dependencias y scripts
├── .env                      # Configuración (no compartir)
├── TRABAJADORES.xlsx         # Datos originales importados
├── data/
│   └── employees.db          # Base de datos SQLite
├── src/
│   ├── database/
│   │   ├── db.js            # Conexión a BD
│   │   ├── schema.sql       # Esquema de tablas
│   │   └── import.js        # Script de importación
│   ├── middleware/
│   │   └── auth.js          # Autenticación JWT
│   └── routes/
│       ├── auth.routes.js   # Rutas de autenticación
│       ├── employees.routes.js  # CRUD empleados
│       ├── vacations.routes.js  # Gestión vacaciones
│       └── absences.routes.js   # Gestión bajas
└── public/
    ├── index.html           # Login
    ├── dashboard.html       # Dashboard principal
    ├── employees.html       # Lista de empleados
    ├── employee-form.html   # Formulario empleado
    ├── vacations.html       # Gestión vacaciones
    ├── absences.html        # Gestión bajas
    ├── css/
    │   └── styles.css       # Estilos globales
    └── js/
        └── api.js           # Cliente API

## 🌐 API Endpoints

### Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/logout` - Cerrar sesión

### Empleados
- `GET /api/employees` - Listar empleados (con filtros y paginación)
- `GET /api/employees/stats` - Estadísticas generales
- `GET /api/employees/:id` - Obtener empleado
- `POST /api/employees` - Crear empleado
- `PUT /api/employees/:id` - Actualizar empleado
- `DELETE /api/employees/:id` - Dar de baja empleado

### Vacaciones
- `GET /api/vacations` - Listar vacaciones
- `GET /api/vacations/calendar` - Vista de calendario
- `POST /api/vacations` - Crear solicitud
- `PUT /api/vacations/:id` - Aprobar/rechazar
- `DELETE /api/vacations/:id` - Eliminar solicitud

### Bajas
- `GET /api/absences` - Listar bajas
- `POST /api/absences` - Registrar baja
- `PUT /api/absences/:id` - Actualizar/cerrar baja
- `DELETE /api/absences/:id` - Eliminar baja

## 🎨 Tecnologías Utilizadas

### Backend
- **Node.js** - Runtime de JavaScript
- **Express** - Framework web
- **SQLite3** - Base de datos
- **JWT** - Autenticación
- **bcrypt** - Hash de contraseñas
- **XLSX** - Lectura de Excel

### Frontend
- **HTML5** - Estructura
- **CSS3** - Estilos (variables CSS, grid, flexbox)
- **JavaScript** - Lógica
- **Chart.js** - Gráficos interactivos
- **Google Fonts (Inter)** - Tipografía

## 🔧 Scripts Disponibles

```bash
# Iniciar servidor en modo producción
npm start

# Importar datos desde Excel
npm run import-data
````

## 📊 Datos Importados

El sistema incluye **49 trabajadores** importados desde el archivo Excel original:

- **Ubicaciones**: FABRICA, MORADAS, SALAMANCA 2, TRES CRUCES, PINILLA, PLAZA CIRCULAR, y más
- **Puestos**: PEON, OFICIAL, DEPENDIENTE/A, ENCARGADO, AYUDANTE, ADMINISTRATIVO, etc.
- **Datos completos**: Nombre, DNI, teléfono, email, puesto, ubicación

## 🛡️ Seguridad

- ✅ Contraseñas hasheadas con bcrypt
- ✅ Autenticación con JWT
- ✅ Validación de datos en backend
- ✅ Protección contra SQL injection (queries parametrizadas)
- ✅ CORS configurado

## 📝 Notas Importantes

1. **Base de Datos**: El archivo `employees.db` contiene todos los datos. Haz backup regularmente.
2. **Credenciales**: Cambia las credenciales por defecto antes de poner en producción.
3. **Puerto**: El servidor usa el puerto 3000 por defecto (configurable en `.env`).
4. **Datos Sensibles**: No compartas el archivo `.env` ni la base de datos `employees.db`.

## 🐛 Resolución de Problemas

### El servidor no inicia

```bash
# Verifica que el puerto 3000 esté libre
# O cambia el puerto en .env
```

### No puedo hacer login

```bash
# Reimporta los datos
npm run import-data
```

### Los datos no aparecen

```bash
# Verifica que la importación fue exitosa
npm run import-data
```

## 📞 Soporte

Para cualquier problema o pregunta sobre el sistema, revisa:

1. Los logs del servidor en la consola
2. La consola del navegador (F12) para errores de frontend
3. El archivo de base de datos en `data/employees.db`

---

**Desarrollado con ❤️ usando Node.js, Express y tecnologías web modernas**
