# 📍 Gestión de Ubicaciones y Calendarios Laborales

## Descripción

Este módulo permite gestionar las ubicaciones geográficas que agrupan diferentes tiendas, cada una con su propio calendario laboral que incluye festivos nacionales y locales.

## Características

### ✨ Funcionalidades Principales

1. **Gestión de Ubicaciones**
   - Crear, editar y eliminar ubicaciones
   - Cada ubicación agrupa múltiples tiendas
   - Descripción y metadata de cada ubicación

2. **Gestión de Tiendas**
   - Añadir tiendas a cada ubicación
   - Editar información de tiendas (nombre, dirección)
   - Cada tienda tiene su calendario laboral independiente

3. **Calendarios Laborales**
   - Visualización mensual de festivos
   - Festivos nacionales (compartidos por todas las tiendas)
   - Festivos locales específicos de cada tienda
   - Añadir, editar y eliminar festivos locales
   - Soporte para festivos recurrentes anuales

4. **Control de Permisos**
   - **Administrador**: Acceso completo a todas las ubicaciones y tiendas
   - **Coordinador de Tiendas**: Solo ve las ubicaciones que contienen tiendas de su scope

## Estructura de Datos

### Modelo Location

```javascript
{
    name: String,              // Nombre de la ubicación (ej: "Madrid")
    description: String,       // Descripción opcional
    stores: [{
        name: String,          // Nombre de la tienda
        address: String,       // Dirección física
        localHolidays: [{
            date: Date,        // Fecha del festivo
            name: String,      // Nombre del festivo
            isRecurring: Boolean // Si se repite cada año
        }],
        active: Boolean
    }],
    active: Boolean
}
```

## Uso

### Acceder al Módulo

1. Iniciar sesión como **Administrador** o **Coordinador de Tiendas**
2. En el menú lateral, hacer clic en **📍 Ubicaciones**
3. O desde el Dashboard, hacer clic en **Gestionar Ubicaciones**

### Flujo de Trabajo

#### 1. Ver Ubicaciones
- Al entrar, se muestran todas las ubicaciones disponibles en forma de tarjetas
- Cada tarjeta muestra:
  - Nombre de la ubicación
  - Descripción (si existe)
  - Número de tiendas

#### 2. Ver Tiendas de una Ubicación
- Hacer clic en una tarjeta de ubicación
- Se despliegan todas las tiendas de esa ubicación
- Cada tienda muestra:
  - Nombre
  - Dirección
  - Número de festivos locales

#### 3. Ver Calendario de una Tienda
- Hacer clic en una tienda
- Se muestra el calendario laboral del año actual
- Los festivos se organizan por meses
- Colores:
  - 🔵 **Azul**: Festivos nacionales (no editables)
  - 🟡 **Amarillo**: Festivos locales (editables)

#### 4. Añadir Festivo Local
- En la vista de calendario, hacer clic en **➕ Añadir Festivo Local**
- Completar el formulario:
  - Fecha del festivo
  - Nombre descriptivo
  - Marcar si es recurrente (se repetirá cada año)
- Guardar

#### 5. Editar/Eliminar Festivo Local
- Los festivos locales tienen botones de edición (✏️) y eliminación (🗑️)
- Los festivos nacionales no se pueden editar desde aquí

## Integración con Vacaciones

Los festivos configurados aquí se utilizan automáticamente en el cálculo de vacaciones:

- Al calcular días laborables de vacaciones, se excluyen:
  - Sábados y domingos
  - Festivos nacionales
  - Festivos locales de la tienda del empleado

Ejemplo:
```
Empleado de "Tienda Madrid Centro" solicita vacaciones del 1 al 15 de mayo
Sistema calcula días laborables excluyendo:
- Fines de semana
- 1 de mayo (festivo nacional)
- 15 de mayo (San Isidro, festivo local de Madrid)
```

## API Endpoints

### Ubicaciones

```
GET    /api/locations              # Obtener todas las ubicaciones
GET    /api/locations/:id          # Obtener una ubicación específica
POST   /api/locations              # Crear ubicación (solo admin)
PUT    /api/locations/:id          # Actualizar ubicación (solo admin)
DELETE /api/locations/:id          # Eliminar ubicación (solo admin)
```

### Tiendas

```
POST   /api/locations/:id/stores                # Añadir tienda
PUT    /api/locations/:id/stores/:storeId       # Actualizar tienda
DELETE /api/locations/:id/stores/:storeId       # Eliminar tienda
```

### Calendarios

```
GET    /api/locations/:id/stores/:storeId/calendar/:year        # Obtener calendario
POST   /api/locations/:id/stores/:storeId/holidays              # Añadir festivo local
PUT    /api/locations/:id/stores/:storeId/holidays/:holidayId   # Actualizar festivo
DELETE /api/locations/:id/stores/:storeId/holidays/:holidayId   # Eliminar festivo
```

## Scripts de Utilidad

### Inicializar Ubicaciones de Ejemplo

```bash
node scripts/seed-locations.js
```

Crea ubicaciones y tiendas de ejemplo:
- Madrid (2 tiendas)
- Barcelona (1 tienda)
- Valencia (1 tienda)

Cada tienda incluye algunos festivos locales típicos.

## Configuración de Permisos

### Para Coordinadores de Tiendas

1. Ir a **⚙️ Configuración**
2. Sección **🧑‍💼 Coordinador de Tiendas**
3. Activar el checkbox **Ubicaciones** en "Secciones a las que tendrá acceso"
4. Guardar configuración

El coordinador solo verá:
- Ubicaciones que contengan al menos una tienda de su scope
- Tiendas que estén en su lista de tiendas permitidas (configurada en Settings)

## Mejores Prácticas

### 📌 Nomenclatura
- Usar nombres descriptivos para ubicaciones: "Madrid", "Barcelona", "Andalucía"
- Nombres de tiendas claros: "Tienda Madrid Centro", "Tienda Barcelona Norte"

### 📅 Festivos
- Configurar festivos nacionales una sola vez usando la gestión de festivos nacional
- Solo añadir festivos locales específicos de cada tienda aquí
- Usar la opción "recurrente" para festivos que se repiten cada año

### 🏪 Organización
- Agrupar tiendas por proximidad geográfica
- Una ubicación = Una región/provincia/comunidad autónoma

### 🔒 Seguridad
- Solo admin puede crear/modificar ubicaciones y tiendas
- Coordinadores pueden editar festivos locales de sus tiendas
- Verificar permisos en Configuración antes de dar acceso

## Solución de Problemas

### El coordinador no ve ninguna ubicación
- Verificar que tiene activado el permiso "Ubicaciones" en Configuración
- Verificar que las tiendas de las ubicaciones están en su lista de tiendas permitidas
- Las ubicaciones sin tiendas permitidas no se muestran

### No puedo eliminar una ubicación/tienda
- No se pueden eliminar ubicaciones o tiendas que tengan empleados asignados
- Reasignar o dar de baja a los empleados primero

### Los festivos no aparecen en el cálculo de vacaciones
- Verificar que la tienda del empleado tiene configurados los festivos
- Los festivos nacionales se configuran en la sección de Festivos del menú principal
- Los festivos locales deben añadirse en el calendario de cada tienda

## Archivos Relacionados

```
src/
  models/
    Location.js                    # Modelo de ubicaciones
  routes/
    locations.routes.js            # Rutas de API
public/
  locations.html                   # Interfaz de usuario
  js/
    locations.js                   # Lógica del cliente
scripts/
  seed-locations.js                # Script de inicialización
```

## Próximas Mejoras

- [ ] Importar/exportar ubicaciones y calendarios
- [ ] Plantillas de festivos por comunidad autónoma
- [ ] Vista de calendario anual completo
- [ ] Notificaciones de próximos festivos
- [ ] Estadísticas de festivos por ubicación
- [ ] Sincronización con calendario oficial de festivos

---

**Versión**: 1.0.0  
**Última actualización**: Diciembre 2025
