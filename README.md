# 👥 Sistema de Gestión de Trabajadores

Sistema completo de gestión de recursos humanos con backend robusto, base de datos SQLite y dashboard interactivo moderno.

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

## 📋 Descripción

Aplicación web full-stack para la gestión integral de empleados, incluyendo control de vacaciones, bajas médicas, y administración de datos personales. Desarrollada con tecnologías modernas y diseño premium.

## ✨ Características

### 🔐 Backend API REST

- **Node.js + Express** con arquitectura modular
- **Base de datos SQLite** (portátil, sin configuración adicional)
- **Autenticación JWT** segura
- **Endpoints CRUD completos** para gestión de empleados, vacaciones y bajas
- **Importación automática** desde archivos Excel

### 🎨 Frontend Dashboard

- **Diseño moderno** con modo oscuro premium
- **Glassmorphism** y animaciones suaves
- **Gráficos interactivos** con Chart.js
- **Diseño responsive** (móvil, tablet, desktop)
- **Búsqueda y filtros** avanzados
- **Gestión completa** de empleados

### 📊 Funcionalidades

- ✅ Gestión de empleados (CRUD completo)
- ✅ Control de vacaciones (solicitudes, aprobaciones)
- ✅ Registro de bajas médicas
- ✅ Historial laboral (altas, bajas, cambios)
- ✅ Estadísticas y reportes
- ✅ Sistema de backup y restauración

## 🚀 Instalación Rápida

### Prerrequisitos

- Node.js 14 o superior
- NPM

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/Albanta23/employee-management-system.git
cd employee-management-system

# 2. Instalar dependencias
npm install

# 3. Importar datos (si tienes un archivo TRABAJADORES.xlsx)
npm run import-data

# 4. Iniciar el servidor
npm start
```

El servidor se iniciará en **http://localhost:3000**

## 🔑 Acceso al Sistema

**Credenciales por defecto:**

- **Usuario:** `admin`
- **Contraseña:** `admin123`

> ⚠️ **IMPORTANTE**: Cambia estas credenciales inmediatamente en producción usando `npm run change-password`

## 📖 Uso

### Dashboard Principal

- Visualiza estadísticas en tiempo real
- Gráficos de distribución por ubicación y puesto
- Accesos rápidos a funciones principales

### Gestión de Trabajadores

- Lista completa con búsqueda y filtros
- Alta de nuevos empleados
- Edición de datos existentes
- Dar de baja trabajadores

### Gestión de Vacaciones

- Crear solicitudes de vacaciones
- Aprobar o rechazar solicitudes
- Calendario de vacaciones
- Estadísticas de días disponibles

### Gestión de Bajas Médicas

- Registrar bajas (médicas, maternidad, paternidad, accidente)
- Seguimiento de bajas activas
- Cerrar bajas completadas

## 🛠️ Scripts Disponibles

```bash
npm start              # Iniciar servidor
npm run import-data    # Importar datos desde Excel
npm run change-password # Cambiar contraseña admin
npm run backup         # Crear backup de BD
npm run restore        # Restaurar desde backup
```

## 📁 Estructura del Proyecto

```
employee-management-system/
├── server.js                 # Servidor principal
├── package.json              # Dependencias
├── .env.example              # Ejemplo de configuración
├── src/
│   ├── database/
│   │   ├── db.js            # Conexión a BD
│   │   ├── schema.sql       # Esquema de tablas
│   │   └── import.js        # Importación de datos
│   ├── middleware/
│   │   └── auth.js          # Autenticación JWT
│   └── routes/
│       ├── auth.routes.js   # Rutas de autenticación
│       ├── employees.routes.js  # CRUD empleados
│       ├── vacations.routes.js  # Gestión vacaciones
│       └── absences.routes.js   # Gestión bajas
├── public/
│   ├── index.html           # Login
│   ├── dashboard.html       # Dashboard principal
│   ├── employees.html       # Lista empleados
│   ├── employee-form.html   # Formulario empleado
│   ├── vacations.html       # Gestión vacaciones
│   ├── absences.html        # Gestión bajas
│   ├── css/
│   │   └── styles.css       # Estilos globales
│   └── js/
│       └── api.js           # Cliente API
└── scripts/
    ├── backup.js            # Script de backup
    ├── restore.js           # Script de restauración
    └── change-password.js   # Cambio de contraseña
```

## 🌐 API Endpoints

### Autenticación

- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/logout` - Cerrar sesión

### Empleados

- `GET /api/employees` - Listar empleados
- `GET /api/employees/stats` - Estadísticas
- `GET /api/employees/:id` - Obtener empleado
- `POST /api/employees` - Crear empleado
- `PUT /api/employees/:id` - Actualizar empleado
- `DELETE /api/employees/:id` - Dar de baja

### Vacaciones

- `GET /api/vacations` - Listar vacaciones
- `GET /api/vacations/calendar` - Vista calendario
- `POST /api/vacations` - Crear solicitud
- `PUT /api/vacations/:id` - Aprobar/rechazar
- `DELETE /api/vacations/:id` - Eliminar

### Bajas

- `GET /api/absences` - Listar bajas
- `POST /api/absences` - Registrar baja
- `PUT /api/absences/:id` - Actualizar/cerrar
- `DELETE /api/absences/:id` - Eliminar

## 🔒 Seguridad

- ✅ Contraseñas hasheadas con bcrypt
- ✅ Autenticación con JWT
- ✅ Validación de datos en backend
- ✅ Protección contra SQL injection
- ✅ CORS configurado

## 🚢 Despliegue en Producción

### Red Local

Para uso dentro de una oficina, configura la IP de la máquina servidor y accede desde `http://IP_LOCAL:3000`

### Nube (Recomendado)

El proyecto está listo para desplegarse en:

- **Railway.app** (~$5/mes)
- **DigitalOcean** (~$6/mes)
- **Heroku** (Free/Basic)
- **Azure/AWS** (Empresarial)

Ver guía completa de despliegue en la documentación.

## 📝 Configuración de Producción

1. **Cambiar credenciales:**

   ```bash
   npm run change-password
   ```

2. **Configurar backups automáticos:**

   ```bash
   # Crear backup manual
   npm run backup
   ```

3. **Actualizar .env:**
   - Cambiar `JWT_SECRET` por un valor aleatorio y seguro
   - Configurar `NODE_ENV=production`

## 🛡️ Backup y Restauración

```bash
# Crear backup
npm run backup

# Restaurar desde backup
npm run restore
```

Los backups se guardan en la carpeta `backups/` con timestamp.

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.

## 👤 Autor

**Albanta23**

- GitHub: [@Albanta23](https://github.com/Albanta23)

## 🙏 Agradecimientos

- Chart.js por los gráficos interactivos
- Google Fonts por la tipografía Inter
- Comunidad de Node.js y Express

---

**Desarrollado con ❤️ usando Node.js, Express y tecnologías web modernas**

⭐ Si este proyecto te ha sido útil, considera darle una estrella en GitHub
