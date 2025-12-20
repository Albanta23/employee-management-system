# 🚀 Guía de Despliegue en Coolify

Esta guía detalla los pasos para desplegar el **Sistema de Gestión de Empleados** en Coolify usando el Dockerfile proporcionado.

## 1. Requisitos Previos

*   Instancia de **Coolify** operativa.
*   Acceso a tu repositorio de código (GitHub, GitLab, o subida manual).
*   URL de conexión de **MongoDB Atlas** (ya la tienes configurada en el `.env` local).

## 2. Configuración en Coolify

### Paso 1: Crear un nuevo Recurso
1. Entra en tu dashboard de Coolify.
2. Haz clic en **"Create New Resource"**.
3. Selecciona **"Public/Private Repository"** (si lo tienes en Git) o el método que prefieras.

### Paso 2: Configurar el Tipo de Despliegue
1. Coolify detectará automáticamente el archivo `Dockerfile`.
2. Asegúrate de que el **Build Pack** esté configurado como `Dockerfile`.
3. Puerto de la aplicación: `3000`.

### Paso 3: Variables de Entorno (CRÍTICO)
Ve a la pestaña **"Environment Variables"** en Coolify y añade las siguientes:

| Variable | Valor |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `MONGODB_URI` | `mongodb+srv://dbjavier:Albanta2025@cluster0.e16j9g4.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0` |
| `JWT_SECRET` | `tu_clave_secreta_aqui` (puedes usar una aleatoria larga) |

### Paso 4: Dominios
En la pestaña **"General"**, configura el dominio o subdominio donde quieres que sea accesible la aplicación (ej: `gestion.tudominio.com`). Coolify gestionará automáticamente el certificado **SSL (HTTPS)** con Let's Encrypt.

## 3. Consideraciones del Backend

Como el sistema usa **Node.js + Express**, Coolify levantará el contenedor y el servidor estará escuchando en el puerto 3000. 

*   **Salud (Health Check):** Puedes configurar un health check en la ruta `/` o crear una ruta específica `/api/health` si lo deseas.
*   **Persistencia:** Al usar MongoDB Atlas (base de datos externa), no necesitas configurar volúmenes de datos en Coolify para la base de datos, lo cual simplifica mucho el despliegue.

## 4. Despliegue
Haz clic en **"Deploy"** y espera a que Coolify termine de construir la imagen e iniciar el contenedor. Una vez finalizado, el estado cambiará a `Running`.

---
*Documentación generada para el sistema de gestión RH - 20/12/2024*
