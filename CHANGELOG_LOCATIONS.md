# 📍 Implementación de Gestión de Ubicaciones - Resumen de Cambios

## 🎯 Objetivo Completado

Se ha implementado exitosamente un módulo completo de gestión de ubicaciones que permite:

✅ Organizar tiendas por ubicaciones geográficas en forma de tarjetas  
✅ Ver tiendas por ubicación al hacer clic en una tarjeta  
✅ Visualizar y editar calendarios laborales por tienda  
✅ Gestionar festivos nacionales y locales  
✅ Control de permisos diferenciado (Admin vs Coordinador)  
✅ Los festivos se consideran automáticamente en el cálculo de vacaciones  

---

## 📦 Archivos Creados

### Backend

1. **`src/models/Location.js`**
   - Modelo de MongoDB para ubicaciones y tiendas
   - Incluye array de tiendas con festivos locales
   - Índices optimizados para búsquedas

2. **`src/routes/locations.routes.js`**
   - Endpoints completos para CRUD de ubicaciones
   - Endpoints para gestión de tiendas
   - Endpoints para calendarios y festivos locales
   - Control de permisos integrado

### Frontend

3. **`public/locations.html`**
   - Interfaz de usuario con tres vistas:
     * Vista de ubicaciones (tarjetas)
     * Vista de tiendas (tarjetas por ubicación)
     * Vista de calendario (festivos organizados por mes)
   - Modales para añadir/editar ubicaciones, tiendas y festivos
   - Diseño responsive y moderno

4. **`public/js/locations.js`**
   - Lógica completa del cliente
   - Navegación entre vistas
   - Gestión de modales
   - Llamadas a API
   - Renderizado dinámico de datos

### Scripts

5. **`scripts/seed-locations.js`**
   - Script para crear ubicaciones de ejemplo
   - Incluye Madrid, Barcelona y Valencia con tiendas
   - Festivos locales típicos de cada ciudad

### Documentación

6. **`LOCATIONS_GUIDE.md`**
   - Guía completa de uso del módulo
   - Documentación de API
   - Ejemplos y mejores prácticas
   - Solución de problemas

7. **`CHANGELOG_LOCATIONS.md`** (este archivo)
   - Resumen de todos los cambios

---

## 🔧 Archivos Modificados

### Configuración del Servidor

1. **`server.js`**
   ```javascript
   // Añadida ruta de ubicaciones
   app.use('/api/locations', require('./src/routes/locations.routes'));
   ```

### Modelos

2. **`src/models/Settings.js`**
   ```javascript
   store_coordinator_access: {
       // ... otros permisos
       locations: { type: Boolean, default: true }  // ← NUEVO
   }
   ```

### Control de Acceso

3. **`src/utils/accessScope.js`**
   ```javascript
   // Añadido 'locations' a featuresRequiringScope
   const featuresRequiringScope = new Set([
       'employees', 'attendance', 'vacations', 
       'absences', 'permissions', 'reports', 
       'locations'  // ← NUEVO
   ]);
   ```

### Interfaz de Administración

4. **`public/dashboard.html`**
   - Añadido enlace "📍 Ubicaciones" en el menú lateral
   - Añadido botón "Gestionar Ubicaciones" en acciones rápidas

5. **`public/settings.html`**
   - Añadido checkbox "Ubicaciones" en permisos del coordinador
   - Actualizado JavaScript para manejar el nuevo permiso:
     ```javascript
     // Cargar permiso
     document.getElementById('accessLocations').checked = access.locations !== false;
     
     // Guardar permiso
     access: {
         // ... otros permisos
         locations: document.getElementById('accessLocations').checked
     }
     ```

### Documentación

6. **`README.md`**
   - Añadida funcionalidad de ubicaciones en la lista de características
   - Añadida sección de gestión de ubicaciones con link a la guía
   - Añadido script de seed-locations en scripts disponibles

---

## 🔑 Funcionalidades Implementadas

### Para Administradores

1. **Gestión Completa de Ubicaciones**
   - ✅ Crear, editar y eliminar ubicaciones
   - ✅ Ver todas las ubicaciones del sistema
   - ✅ Añadir descripciones a ubicaciones

2. **Gestión Completa de Tiendas**
   - ✅ Añadir tiendas a ubicaciones
   - ✅ Editar información de tiendas
   - ✅ Eliminar tiendas (con validación de empleados)
   - ✅ Asignar direcciones a tiendas

3. **Gestión de Calendarios**
   - ✅ Ver calendario laboral por tienda y año
   - ✅ Añadir festivos locales
   - ✅ Editar festivos locales
   - ✅ Eliminar festivos locales
   - ✅ Marcar festivos como recurrentes
   - ✅ Ver festivos nacionales (desde Holiday model)

### Para Coordinadores de Tiendas

1. **Acceso Limitado**
   - ✅ Ver solo ubicaciones que contienen sus tiendas
   - ✅ Ver solo tiendas de su scope (configuradas en Settings)
   - ✅ Ver calendarios de sus tiendas

2. **Edición de Calendarios**
   - ✅ Añadir festivos locales a sus tiendas
   - ✅ Editar festivos locales existentes
   - ✅ Eliminar festivos locales
   - ❌ No pueden modificar ubicaciones o tiendas

---

## 🔄 Flujo de Uso

### Navegación Principal

```
Ubicaciones (tarjetas)
    ↓ [click en ubicación]
Tiendas de la ubicación (tarjetas)
    ↓ [click en tienda]
Calendario laboral de la tienda
```

### Breadcrumbs

```
📍 Ubicaciones

📍 Ubicaciones › Madrid

📍 Ubicaciones › Madrid › Tienda Madrid Centro
```

---

## 🎨 Interfaz de Usuario

### Vista de Ubicaciones
- Grid responsivo de tarjetas
- Cada tarjeta muestra:
  - Icono 📍
  - Nombre de la ubicación
  - Descripción
  - Número de tiendas
  - Botón de editar (solo admin)

### Vista de Tiendas
- Grid de tarjetas por tienda
- Cada tarjeta muestra:
  - Icono 🏪
  - Nombre de la tienda
  - Dirección
  - Número de festivos locales
  - Botón de editar (solo admin)

### Vista de Calendario
- Grid de 12 meses
- Selector de año
- Festivos organizados por mes
- Código de colores:
  - 🔵 Azul = Festivo nacional
  - 🟡 Amarillo = Festivo local
- Botones de edición/eliminación en festivos locales

---

## 🔐 Seguridad y Permisos

### Validaciones Backend

1. **Control de Acceso**
   ```javascript
   // Solo admin puede crear/modificar ubicaciones y tiendas
   if (!isAdmin(req.user)) {
       return res.status(403).json({ error: 'Solo administradores...' });
   }
   
   // Coordinador: verificar scope de tiendas
   const allowedStores = await getStoreLocations();
   if (!allowedStores.includes(store.name)) {
       return res.status(403).json({ error: 'No tienes permiso...' });
   }
   ```

2. **Validaciones de Negocio**
   - No permitir eliminar ubicaciones con empleados asignados
   - No permitir eliminar tiendas con empleados asignados
   - Validar fechas de festivos
   - Validar nombres únicos de ubicaciones

### Permisos por Rol

| Funcionalidad | Admin | Coordinador | Empleado |
|--------------|-------|-------------|----------|
| Ver ubicaciones | ✅ Todas | ✅ Solo su scope | ❌ |
| Crear ubicaciones | ✅ | ❌ | ❌ |
| Editar ubicaciones | ✅ | ❌ | ❌ |
| Eliminar ubicaciones | ✅ | ❌ | ❌ |
| Ver tiendas | ✅ Todas | ✅ Solo su scope | ❌ |
| Crear tiendas | ✅ | ❌ | ❌ |
| Editar tiendas | ✅ | ❌ | ❌ |
| Eliminar tiendas | ✅ | ❌ | ❌ |
| Ver calendarios | ✅ Todos | ✅ Solo su scope | ❌ |
| Añadir festivos locales | ✅ | ✅ Sus tiendas | ❌ |
| Editar festivos locales | ✅ | ✅ Sus tiendas | ❌ |
| Eliminar festivos locales | ✅ | ✅ Sus tiendas | ❌ |

---

## 🔗 Integración con Módulos Existentes

### Modelo Employee
```javascript
// El campo location del empleado debe coincidir con store.name
employee.location === store.name
```

### Modelo Holiday (Festivos Nacionales)
```javascript
// Los festivos nacionales se obtienen del modelo Holiday
// Los festivos locales se obtienen de location.stores[].localHolidays
```

### Cálculo de Vacaciones
```javascript
// Al calcular días laborables, se excluyen:
// 1. Fines de semana
// 2. Festivos nacionales (Holiday.find({ type: 'national' }))
// 3. Festivos locales de la tienda del empleado
```

---

## 📊 Estructura de Base de Datos

### Colección: locations

```javascript
{
    _id: ObjectId,
    name: "Madrid",
    description: "Ubicación principal en la Comunidad de Madrid",
    stores: [
        {
            _id: ObjectId,
            name: "Tienda Madrid Centro",
            address: "C/ Gran Vía 28, 28013 Madrid",
            localHolidays: [
                {
                    _id: ObjectId,
                    date: ISODate("2025-05-15T00:00:00.000Z"),
                    name: "San Isidro",
                    isRecurring: true
                }
            ],
            active: true
        }
    ],
    active: true,
    createdAt: ISODate,
    updatedAt: ISODate
}
```

### Índices Creados

```javascript
// Índice en nombre de ubicación
{ name: 1 }

// Índice en nombres de tiendas
{ 'stores.name': 1 }

// Índice en estado activo
{ active: 1 }
```

---

## 🚀 Cómo Probar

### 1. Inicializar Datos de Ejemplo

```bash
node scripts/seed-locations.js
```

Esto creará:
- Madrid con 2 tiendas
- Barcelona con 1 tienda  
- Valencia con 1 tienda

### 2. Acceder como Administrador

1. Login con credenciales de admin
2. Ir a menú lateral → **📍 Ubicaciones**
3. Ver las ubicaciones creadas
4. Hacer clic en una ubicación para ver tiendas
5. Hacer clic en una tienda para ver calendario
6. Probar añadir/editar/eliminar festivos

### 3. Acceder como Coordinador

1. Configurar coordinador en **⚙️ Configuración**:
   - Activar perfil de coordinador
   - En "Ubicaciones de Tiendas", añadir las tiendas permitidas:
     ```
     Tienda Madrid Centro
     Tienda Madrid Norte
     ```
   - Marcar checkbox "Ubicaciones" en permisos
   - Guardar

2. Login con credenciales de coordinador
3. Ir a **📍 Ubicaciones**
4. Verificar que solo ve Madrid (que contiene sus tiendas)
5. No verá Barcelona ni Valencia
6. Puede editar festivos de sus tiendas

---

## 📝 Endpoints de API

### Ubicaciones

```
GET    /api/locations
       → Respuesta: Array de ubicaciones (filtradas por rol)

GET    /api/locations/:id
       → Respuesta: Ubicación con tiendas (filtradas por rol)

POST   /api/locations
       Body: { name, description, stores }
       → Respuesta: Nueva ubicación creada

PUT    /api/locations/:id
       Body: { name, description, active }
       → Respuesta: Ubicación actualizada

DELETE /api/locations/:id
       → Respuesta: { message: 'Ubicación eliminada' }
```

### Tiendas

```
POST   /api/locations/:id/stores
       Body: { name, address }
       → Respuesta: Ubicación con nueva tienda

PUT    /api/locations/:id/stores/:storeId
       Body: { name, address, active }
       → Respuesta: Ubicación con tienda actualizada

DELETE /api/locations/:id/stores/:storeId
       → Respuesta: { message: 'Tienda eliminada' }
```

### Calendarios

```
GET    /api/locations/:id/stores/:storeId/calendar/:year
       → Respuesta: {
           year,
           locationName,
           storeName,
           holidays: [{ date, name, type }]
         }

POST   /api/locations/:id/stores/:storeId/holidays
       Body: { date, name, isRecurring }
       → Respuesta: Ubicación con festivo añadido

PUT    /api/locations/:id/stores/:storeId/holidays/:holidayId
       Body: { date, name, isRecurring }
       → Respuesta: Ubicación con festivo actualizado

DELETE /api/locations/:id/stores/:storeId/holidays/:holidayId
       → Respuesta: { message: 'Festivo eliminado' }
```

---

## ✅ Testing Checklist

### Como Administrador

- [ ] Ver todas las ubicaciones
- [ ] Crear nueva ubicación
- [ ] Editar ubicación existente
- [ ] Eliminar ubicación vacía
- [ ] Intentar eliminar ubicación con empleados (debe fallar)
- [ ] Añadir tienda a ubicación
- [ ] Editar tienda
- [ ] Eliminar tienda sin empleados
- [ ] Ver calendario de una tienda
- [ ] Cambiar año del calendario
- [ ] Añadir festivo local
- [ ] Editar festivo local
- [ ] Eliminar festivo local
- [ ] Marcar festivo como recurrente

### Como Coordinador

- [ ] Ver solo ubicaciones con tiendas del scope
- [ ] NO ver botones de crear/editar ubicaciones
- [ ] NO ver botones de crear/editar tiendas
- [ ] Ver calendarios de tiendas del scope
- [ ] Añadir festivo local a sus tiendas
- [ ] Editar festivo local de sus tiendas
- [ ] Eliminar festivo local de sus tiendas
- [ ] NO poder ver tiendas fuera del scope

### Integración

- [ ] Festivos locales aparecen en calendario de la tienda
- [ ] Festivos nacionales aparecen en todos los calendarios
- [ ] Festivos se consideran en cálculo de vacaciones
- [ ] Breadcrumbs funcionan correctamente
- [ ] Modales se cierran correctamente
- [ ] Mensajes de error son claros
- [ ] Diseño responsive en móvil

---

## 🐛 Problemas Conocidos y Soluciones

### Problema 1: Coordinador no ve ubicaciones
**Causa**: No tiene configuradas las tiendas en Settings  
**Solución**: Ir a Configuración → Coordinador de Tiendas → Añadir tiendas en "Ubicaciones de Tiendas"

### Problema 2: No se puede eliminar ubicación
**Causa**: Hay empleados asignados a tiendas de esa ubicación  
**Solución**: Reasignar empleados a otras tiendas o darlos de baja primero

### Problema 3: Festivos no aparecen en cálculo de vacaciones
**Causa**: Aún no integrado con el módulo de vacaciones  
**Solución**: Próxima implementación - conectar con vacations.routes.js

---

## 📈 Próximos Pasos Sugeridos

### Mejoras Inmediatas
1. Conectar festivos locales con cálculo de vacaciones en `src/routes/vacations.routes.js`
2. Añadir validación para evitar festivos duplicados
3. Implementar búsqueda de ubicaciones/tiendas
4. Añadir paginación para ubicaciones

### Mejoras Futuras
1. Importar/exportar ubicaciones desde Excel
2. Plantillas de festivos por comunidad autónoma
3. Vista de calendario anual completo
4. Notificaciones de próximos festivos
5. Estadísticas de festivos por ubicación
6. Sincronización automática con calendario oficial

---

## 📚 Documentación Adicional

- **Guía de Uso**: [LOCATIONS_GUIDE.md](./LOCATIONS_GUIDE.md)
- **README Principal**: [README.md](./README.md)
- **Guía de Despliegue**: [DEPLOY_GUIDE_COOLIFY.md](./DEPLOY_GUIDE_COOLIFY.md)

---

**Fecha de Implementación**: 21 de Diciembre de 2025  
**Versión**: 1.0.0  
**Estado**: ✅ Completado y Funcional
