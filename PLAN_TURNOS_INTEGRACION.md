# Plan Técnico: Integración de TurnosPro en el Sistema de Gestión de Empleados

> **Versión:** 1.0
> **Fecha:** 2026-02-24
> **Estado:** Pendiente de implementación
> **Rama sugerida:** `feature/turnos-integration`

---

## 1. Contexto y Análisis

### 1.1 Qué aporta TurnosPro al sistema actual

`TurnosPro.html` es un prototipo standalone de gestión de turnos con las siguientes capacidades que actualmente **no existen** en el sistema:

| Funcionalidad | Estado actual | Lo que aporta |
|---|---|---|
| Turnos grupales (Turno A, B...) | Solo `work_schedule` individual por empleado | Turnos colectivos con horario compartido |
| Calendario visual de turnos | No existe | Vista mensual por turno con chips de horario |
| Motor de cálculo de horas | No existe | Horas programadas vs objetivo semanal exacto |
| Sábados rotativos | No existe | Configuración de sábados libres por índice |
| Simulador de ausencias | No existe | Impacto de bajas en horas y cobertura |
| Publicación de horario a empleados | No existe | Notificación in-app al publicar el horario |
| Balance de horas con sugerencias | No existe | Ajuste sugerido para cuadrar horas exactas |

### 1.2 Arquitectura resultante

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Vanilla JS + HTML — diseño glassmorphism existente)   │
│                                                                  │
│  ┌─────────────────┐  ┌───────────────────┐  ┌───────────────┐  │
│  │  turnos.html    │  │ employee-dashboard│  │ employee-     │  │
│  │  (panel nuevo)  │  │ sección Mi Horario│  │ profile.html  │  │
│  │  admin / coord  │  │ + bandeja notifs  │  │ campo turno   │  │
│  └────────┬────────┘  └────────┬──────────┘  └───────┬───────┘  │
└───────────┼────────────────────┼─────────────────────┼──────────┘
            │ HTTP / JWT Bearer  │                     │
┌───────────▼────────────────────▼─────────────────────▼──────────┐
│  API REST  (Express.js)                                          │
│                                                                  │
│  /api/shifts            shifts.routes.js   (nuevo)              │
│  /api/notifications     notifications.routes.js   (nuevo)       │
│                                                                  │
│  src/utils/hoursEngine.js          (lógica portada de prototipo)│
│  src/utils/notificationService.js  (in-app + EmailJS opcional)  │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ Mongoose
┌──────────────────────────────────▼──────────────────────────────┐
│  MONGODB                                                         │
│  Shift (nuevo)   InAppNotification (nuevo)                       │
│  Employee (extender: + shift_id)                                 │
│  Location / Vacation / Absence / User  (sin cambios)            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Modelos de Datos

### 2.1 Nuevo modelo `Shift`

**Archivo:** `src/models/Shift.js`

```javascript
const shiftSchema = new mongoose.Schema({
  name:        { type: String, required: true },      // "Turno A"
  color:       { type: String, default: '#00C6A2' },  // color hex

  location_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true },
  store_name:  { type: String },   // tienda específica dentro del location

  // Horario entre semana (Lunes–Viernes)
  weekdayStart: { type: String, required: true },  // "08:00"
  weekdayEnd:   { type: String, required: true },  // "16:00"

  // Horario sábado
  satStart: { type: String },   // "08:00"
  satEnd:   { type: String },   // "15:00"

  // Índices de sábados libres en el mes (0=1er sábado, 1=2º, 2=3er, 3=4º)
  // Ej: [0,2] → 1er y 3er sábado libres
  satWeeksOff: { type: [Number], default: [] },

  // Días en que la tienda abre (0=Dom, 1=Lun...6=Sáb)
  openDays: { type: [Number], default: [1,2,3,4,5,6] },

  targetHoursWeek: { type: Number, default: 40 },  // objetivo h/semana por trabajador
  workersPerShift:  { type: Number, default: 1 },  // nº de trabajadores en este turno

  active: { type: Boolean, default: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
```

---

### 2.2 Extensión del modelo `Employee`

**Archivo:** `src/models/Employee.js`
**Cambio:** añadir un campo opcional. No rompe ningún dato existente.

```javascript
// Añadir dentro del schema existente:
shift_id: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Shift',
  default: null
}
```

---

### 2.3 Nuevo modelo `InAppNotification`

**Archivo:** `src/models/InAppNotification.js`

```javascript
const inAppNotificationSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

  type: {
    type: String,
    enum: ['schedule_published', 'shift_changed', 'shift_assigned', 'absence_impact'],
    required: true
  },

  title:   { type: String, required: true },
  body:    { type: String, required: true },
  read:    { type: Boolean, default: false },
  read_at: { type: Date, default: null },

  // Datos adicionales para que el frontend pueda navegar al recurso correcto
  data: {
    shift_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
    month:     Number,   // 0–11
    year:      Number,
  },

  created_at: { type: Date, default: Date.now }
});
```

---

### 2.4 Nuevo modelo `SchedulePublication`

**Archivo:** `src/models/SchedulePublication.js`
Registro histórico de qué horarios se publicaron, cuándo y a quién.

```javascript
const schedulePublicationSchema = new mongoose.Schema({
  shift_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  month:     { type: Number, required: true },   // 0–11
  year:      { type: Number, required: true },

  sent_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sent_at:   { type: Date, default: Date.now },

  employees_notified: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  total_notified:     { type: Number, default: 0 },

  // Snapshot en texto del horario publicado (para auditoría)
  schedule_snapshot: { type: Object }
});
```

---

## 3. Motor de Cálculo de Horas

### 3.1 Archivo `src/utils/hoursEngine.js`

Portar la lógica exacta del prototipo `TurnosPro.html` como módulo Node.js puro, sin dependencias de DOM. Este es el núcleo del sistema y **debe ser idéntico** en backend y frontend para garantizar coherencia.

```javascript
// src/utils/hoursEngine.js

function timeToMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Devuelve los días (números) que son sábado en el mes dado.
 */
function getSaturdays(year, month) {
  const sats = [];
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    if (new Date(year, month, d).getDay() === 6) sats.push(d);
  }
  return sats;
}

/**
 * Calcula horas programadas, objetivo y balance para un turno en un mes.
 *
 * @param {Object} shift  - Documento Shift de MongoDB (o POJO equivalente)
 * @param {number} year
 * @param {number} month  - 0–11
 * @param {number} absenceDaysOverride - días de ausencia a descontar (opcional)
 * @returns {Object} con targetMins, scheduledMins, balanceMins, etc.
 */
function calcShiftHours(shift, year, month, absenceDaysOverride = 0) {
  const last     = new Date(year, month + 1, 0).getDate();
  const sats     = getSaturdays(year, month);
  const openDays = shift.openDays;

  // Sábados en que este turno descansa
  const satOff  = shift.satWeeksOff.map(i => sats[i]).filter(Boolean);
  const satWork = sats.filter(s => !satOff.includes(s) && openDays.includes(6));

  // Contar días laborables entre semana
  let weekdayCount = 0;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6 && openDays.includes(dow)) weekdayCount++;
  }

  const weekdayMins = timeToMins(shift.weekdayEnd) - timeToMins(shift.weekdayStart);
  const satMins     = openDays.includes(6)
    ? timeToMins(shift.satEnd) - timeToMins(shift.satStart)
    : 0;

  const scheduledMins = weekdayCount * weekdayMins + satWork.length * satMins;

  // Objetivo exacto proporcional a las semanas-equivalente del mes
  const weeksInMonth = weekdayCount / 5;
  const targetMins   = Math.round(shift.targetHoursWeek * 60 * weeksInMonth);
  const balanceMins  = scheduledMins - targetMins;

  const absMins      = absenceDaysOverride * weekdayMins;
  const effectiveMins = scheduledMins - absMins;

  return {
    targetMins,
    scheduledMins,
    balanceMins,
    effectiveMins,
    weekdayCount,
    satWorked:   satWork.length,
    satOff:      satOff.length,
    weekdayMins,
    satMins,
    satWorkDays: satWork,
    satOffDays:  satOff,
    absMins,
  };
}

/**
 * Sugiere ajuste del horario de salida para cuadrar exactamente el objetivo.
 */
function suggestAdjustment(shift, year, month) {
  const h = calcShiftHours(shift, year, month);
  if (Math.abs(h.balanceMins) < 5) return null;

  const totalDays = h.weekdayCount + h.satWorked;
  if (totalDays === 0) return null;

  const minsPerDay = h.balanceMins / totalDays;
  const newEndMins = timeToMins(shift.weekdayEnd) - minsPerDay;
  const hh = String(Math.floor(newEndMins / 60)).padStart(2, '0');
  const mm = String(Math.round(newEndMins % 60)).padStart(2, '0');

  return {
    balanceMins:          h.balanceMins,
    minsPerDay:           Math.round(minsPerDay),
    suggestedWeekdayEnd:  `${hh}:${mm}`,
    originalHours:        (h.scheduledMins / 60).toFixed(1),
    targetHours:          (h.targetMins / 60).toFixed(1),
  };
}

module.exports = { calcShiftHours, suggestAdjustment, getSaturdays, timeToMins };
```

---

## 4. Servicio de Notificaciones

### 4.1 Archivo `src/utils/notificationService.js`

```javascript
// src/utils/notificationService.js
// Notificaciones in-app (base). EmailJS se invoca desde el FRONTEND,
// no desde el servidor — ver sección 7.2 para detalles.

const InAppNotification = require('../models/InAppNotification');

async function createInAppNotification(employeeId, type, title, body, data = {}) {
  return InAppNotification.create({ employee_id: employeeId, type, title, body, data });
}

async function notifyShiftPublished(employees, shift, month, year) {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const promises = employees.map(emp =>
    createInAppNotification(
      emp._id,
      'schedule_published',
      `Horario de ${MONTHS[month]} ${year} publicado`,
      `Tu horario para ${MONTHS[month]} ya está disponible. Turno: ${shift.name}.`,
      { shift_id: shift._id, month, year }
    )
  );
  return Promise.all(promises);
}

async function notifyShiftAssigned(employee, shift) {
  return createInAppNotification(
    employee._id,
    'shift_assigned',
    `Asignado a ${shift.name}`,
    `Has sido asignado al ${shift.name} (${shift.weekdayStart}–${shift.weekdayEnd}).`,
    { shift_id: shift._id }
  );
}

module.exports = { createInAppNotification, notifyShiftPublished, notifyShiftAssigned };
```

> **Nota sobre EmailJS:** EmailJS funciona exclusivamente desde el cliente (navegador). Cuando el admin/coordinador pulse "Publicar horario", el frontend invocará EmailJS directamente usando el template configurado, pasando los datos del turno/mes. El backend solo gestiona las notificaciones in-app. Ver sección 7.2.

---

## 5. API REST — Rutas

### 5.1 Archivo `src/routes/shifts.routes.js`

#### Endpoints de Turnos

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| `GET` | `/api/shifts` | Listar turnos (filtrar por `?location_id=`) | admin, coord |
| `POST` | `/api/shifts` | Crear turno | admin, coord |
| `GET` | `/api/shifts/:id` | Obtener turno por ID | admin, coord, employee |
| `PUT` | `/api/shifts/:id` | Editar turno | admin, coord |
| `DELETE` | `/api/shifts/:id` | Eliminar turno | admin |
| `POST` | `/api/shifts/:id/assign-employee` | Asignar empleado (`{ employee_id }`) | admin, coord |
| `DELETE` | `/api/shifts/:id/employees/:empId` | Desasignar empleado | admin, coord |
| `GET` | `/api/shifts/:id/employees` | Listar empleados del turno | admin, coord |

#### Endpoints de Calendario y Horas

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| `GET` | `/api/shifts/:id/calendar` | Datos calendario `?month=&year=` | admin, coord, employee |
| `GET` | `/api/shifts/:id/hours` | Balance horas + sugerencias `?month=&year=` | admin, coord |
| `GET` | `/api/shifts/:id/absence-sim` | Simulación con ausencias reales del mes | admin, coord |

#### Endpoints de Publicación

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| `POST` | `/api/shifts/:id/publish` | Publicar horario + crear notifs in-app | admin, coord |
| `GET` | `/api/shifts/:id/publications` | Historial de publicaciones del turno | admin, coord |

#### Endpoints de Notificaciones In-App

| Método | Ruta | Descripción | Roles |
|--------|------|-------------|-------|
| `GET` | `/api/notifications` | Notificaciones del empleado autenticado | employee |
| `GET` | `/api/notifications/unread-count` | Contador de no leídas | employee |
| `PUT` | `/api/notifications/:id/read` | Marcar como leída | employee |
| `PUT` | `/api/notifications/read-all` | Marcar todas como leídas | employee |

---

### 5.2 Lógica del endpoint `POST /api/shifts/:id/publish`

```
1. Verificar que el shift existe y pertenece a la ubicación del coordinador
2. Obtener todos los empleados con shift_id === :id
3. Llamar hoursEngine.calcShiftHours() para generar snapshot del horario
4. Guardar SchedulePublication con snapshot y lista de empleados
5. Llamar notificationService.notifyShiftPublished() para crear InAppNotification por empleado
6. Devolver { publicationId, employeesNotified: N, snapshot }
   → El frontend usará estos datos para invocar EmailJS si el admin lo decide
```

---

## 6. Frontend — Panel de Turnos (`turnos.html`)

### 6.1 Estructura del panel

Página nueva integrada con el diseño glassmorphism del sistema, accesible desde la barra lateral (admin y store_coordinator).

```
turnos.html
├── Barra lateral existente (nav link añadido)
├── Header con selector de ubicación / tienda
└── 5 subtabs:
    ├── [1] Calendario
    ├── [2] Personal
    ├── [3] Horas y Balance
    ├── [4] Simulador de Ausencias
    └── [5] Publicar Horario
```

### 6.2 Subtab 1 — Calendario

- Selector de turno (dropdown) + navegación mes ← / →
- Grid calendario con chips por turno:
  - Día normal → chip con horario (HH:MM–HH:MM)
  - Sábado trabajado → chip sábado con horario reducido
  - Sábado libre → chip desvanecido con etiqueta "Libre"
  - Día con ausencias → badge de advertencia con número de ausentes
- Leyenda de colores de turnos
- Botones: **Exportar Excel**, **Exportar PDF**

### 6.3 Subtab 2 — Personal del Turno

- Tabla de empleados agrupada por turno
- Columnas: Avatar, Nombre, Estado (Activo/Baja/Vacaciones), Horas mes, Balance, Acciones
- Estados sincronizados con modelos `Absence` y `Vacation` existentes
- Acciones: editar nombre inline, asignar a otro turno, desasignar

### 6.4 Subtab 3 — Horas y Balance

- Stats cards: Horas programadas total · Balance total · Objetivo semanal · Nº empleados
- Por cada turno:
  - Desglose: días laborables, sábados trabajados, sábados libres
  - Total programado vs objetivo con barra de balance
  - Sugerencia de ajuste si desviación > 5 min
  - Desglose individual por empleado (con ausencias aplicadas)

### 6.5 Subtab 4 — Simulador de Ausencias

- Cards por empleado con:
  - Selector: Activo / Baja médica / Vacaciones / Permiso
  - Input días de ausencia
  - Resultado: horas perdidas + compañeros de turno disponibles
- Resumen total: trabajadores ausentes + horas perdidas en el mes
- Datos base desde la BD (ausencias/vacaciones aprobadas del mes)
- Botón "Resetear simulación"

### 6.6 Subtab 5 — Publicar Horario

- Selector de mes a publicar
- Preview: resumen del horario (días, horarios, sábados libres, balance)
- Lista de empleados del turno con checkboxes
  - Auto-marcados por defecto
  - Iconos indicando si el empleado tiene usuario en el sistema
- Dos acciones independientes:
  - **Notificar en la app** → `POST /api/shifts/:id/publish`
  - **Enviar por email (EmailJS)** → invocación directa desde el navegador
- Historial de publicaciones: fecha, publicado por, nº notificados

### 6.7 Archivo JS del panel

**Archivo:** `public/js/turnos.js`

Responsabilidades:
- Consumir todos los endpoints de `/api/shifts`
- Reutilizar `hoursEngine` portado a ES module (o copiar las funciones puras)
- Gestionar el estado del panel (turno activo, mes activo)
- Exportar Excel con `SheetJS` (ya incluido en el proyecto como dependencia)
- Exportar PDF con `jsPDF + autoTable` (incluir CDN o instalar)
- Invocar EmailJS en el paso de publicación

---

## 7. Frontend — Vista del Empleado

### 7.1 Sección "Mi Horario" en `employee-dashboard.html`

Nueva tarjeta en el dashboard del empleado:

```
┌─────────────────────────────────────────────────────┐
│  MI HORARIO — Marzo 2026                            │
│                                                     │
│  Turno A  ■  08:00–16:00 (L–V)                     │
│            ■  08:00–15:00 (Sáb)                     │
│                                                     │
│  Este mes:  Horas programadas: 168.5h               │
│             Objetivo:          168.0h               │
│             Balance:           +0.5h ✓              │
│                                                     │
│  Sábados libres: 1, 15 marzo                        │
│                                                     │
│  [Ver calendario completo]                          │
└─────────────────────────────────────────────────────┘
```

Llamadas necesarias:
- `GET /api/shifts/:myShiftId/calendar?month=&year=`
- `GET /api/shifts/:myShiftId/hours?month=&year=`

### 7.2 Integración EmailJS en la vista del empleado (opcional futuro)

EmailJS se gestiona íntegramente desde el cliente. Cuando el admin publique el horario desde `turnos.html`, el frontend:

1. Recibe de la API la lista de empleados notificados + snapshot del horario
2. Para cada empleado con email registrado, llama a `emailjs.send(serviceId, templateId, params)`
3. Los parámetros del template incluirán: nombre empleado, mes, horario, sábados libres, balance

```javascript
// Ejemplo de invocación desde turnos.js (subtab Publicar)
emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_SCHEDULE, {
  to_name:       employee.full_name,
  to_email:      employee.email,
  shift_name:    shift.name,
  month_label:   'Marzo 2026',
  schedule_text: buildScheduleText(shift, month, year),
  balance_text:  `${(balanceMins / 60).toFixed(1)}h`,
});
```

> Los IDs de servicio y template de EmailJS se añadirán como constantes en un archivo de configuración del frontend (`public/js/config.js` o como `data-` atributos en el HTML).

### 7.3 Campana de notificaciones en el navbar del empleado

Añadir en `employee-dashboard.html` y demás páginas del empleado:

```html
<!-- En la barra de navegación existente -->
<div class="notif-bell" id="notif-bell">
  🔔
  <span class="notif-badge" id="notif-badge" style="display:none">0</span>
</div>
```

Comportamiento:
- Al cargar la página: `GET /api/notifications/unread-count` → mostrar badge si > 0
- Al pulsar la campana: dropdown con las últimas 5 notificaciones
- Cada notificación tiene: título, cuerpo, fecha, badge "NUEVO" si no leída
- Al hacer click en una notificación: `PUT /api/notifications/:id/read` y navegar a "Mi Horario"
- Enlace "Ver todas" al historial completo de notificaciones

---

## 8. Modificaciones en Archivos Existentes

### 8.1 `server.js`

Registrar las nuevas rutas:

```javascript
const shiftsRoutes       = require('./src/routes/shifts.routes');
const notificationsRoutes = require('./src/routes/notifications.routes');

app.use('/api/shifts',         authenticateToken, shiftsRoutes);
app.use('/api/notifications',  authenticateToken, notificationsRoutes);
```

### 8.2 Navegación lateral (todas las páginas con sidebar)

Añadir enlace a `turnos.html` visible solo para admin y store_coordinator:

```html
<a href="turnos.html" class="nav-link" data-roles="admin,store_coordinator">
  <span class="nav-icon">🗓️</span>
  <span class="nav-label">Turnos</span>
</a>
```

### 8.3 `employee-profile.html`

Añadir en la sección de información del empleado:

```
Turno asignado:  [Turno A ■ 08:00–16:00]   [Cambiar turno ▼]  (solo admin/coord)
```

Llamada al cambiar: `PUT /api/employees/:id` con `{ shift_id: newShiftId }` + llamada al servicio de notificación in-app `notifyShiftAssigned`.

### 8.4 `src/models/Employee.js`

```javascript
shift_id: {
  type: mongoose.Schema.Types.ObjectId,
  ref:  'Shift',
  default: null
}
```

---

## 9. Control de Acceso por Rol

| Operación | admin | store_coordinator | employee |
|-----------|:-----:|:-----------------:|:--------:|
| Crear / editar turno | ✅ | ✅ (solo su ubicación) | ❌ |
| Eliminar turno | ✅ | ❌ | ❌ |
| Ver calendario de turno | ✅ | ✅ | ✅ (solo su turno) |
| Ver horas y balance | ✅ | ✅ | ✅ (solo su turno) |
| Asignar / desasignar empleado | ✅ | ✅ | ❌ |
| Publicar horario | ✅ | ✅ | ❌ |
| Ver notificaciones in-app | - | - | ✅ |
| Ver historial publicaciones | ✅ | ✅ | ❌ |

Los `store_coordinator` accederán únicamente a los turnos de las ubicaciones configuradas en `Settings.storeCoordinators`, usando el middleware `ensureEmployeeInScope` ya existente.

---

## 10. Orden de Implementación (Checklist)

```
BACKEND
──────
[ ] Paso  1  src/models/Shift.js
[ ] Paso  2  src/models/InAppNotification.js
[ ] Paso  3  src/models/SchedulePublication.js
[ ] Paso  4  src/models/Employee.js  →  añadir campo shift_id
[ ] Paso  5  src/utils/hoursEngine.js  (portar lógica del prototipo)
[ ] Paso  6  src/utils/notificationService.js
[ ] Paso  7  src/routes/shifts.routes.js  (CRUD + calendar + hours + publish)
[ ] Paso  8  src/routes/notifications.routes.js
[ ] Paso  9  server.js  →  registrar las nuevas rutas

FRONTEND
────────
[ ] Paso 10  public/js/turnos.js  (lógica completa del panel)
[ ] Paso 11  public/turnos.html  (estructura HTML + 5 subtabs)
[ ] Paso 12  public/employee-dashboard.html  →  sección Mi Horario
[ ] Paso 13  public/employee-dashboard.html  →  campana de notificaciones
[ ] Paso 14  public/employee-profile.html  →  campo turno asignado
[ ] Paso 15  Navegación lateral  →  enlace Turnos en todos los layouts
[ ] Paso 16  public/css/styles.css  →  estilos chips, calendar, badge campana

INTEGRACIÓN
───────────
[ ] Paso 17  GET /api/shifts/:id/absence-sim  →  consumir Absence/Vacation reales
[ ] Paso 18  Validar shift en attendance (fichaje dentro de ventana del turno)
[ ] Paso 19  EmailJS: configurar template de horario  +  integrar en turnos.js
[ ] Paso 20  Pruebas end-to-end: publicar horario → notif in-app → vista empleado
```

---

## 11. Archivos Afectados — Resumen

| Archivo | Operación | Descripción |
|---------|-----------|-------------|
| `src/models/Shift.js` | Crear | Modelo de turno |
| `src/models/InAppNotification.js` | Crear | Notificaciones in-app |
| `src/models/SchedulePublication.js` | Crear | Histórico publicaciones |
| `src/utils/hoursEngine.js` | Crear | Motor de cálculo de horas |
| `src/utils/notificationService.js` | Crear | Servicio notificaciones |
| `src/routes/shifts.routes.js` | Crear | API completa de turnos |
| `src/routes/notifications.routes.js` | Crear | API notificaciones in-app |
| `src/models/Employee.js` | Modificar | Añadir `shift_id` |
| `server.js` | Modificar | Registrar nuevas rutas |
| `public/turnos.html` | Crear | Panel de turnos (admin/coord) |
| `public/js/turnos.js` | Crear | Lógica frontend del panel |
| `public/employee-dashboard.html` | Modificar | Mi Horario + campana notifs |
| `public/employee-profile.html` | Modificar | Campo turno asignado |
| `public/css/styles.css` | Modificar | Estilos nuevos componentes |
| Todos los layouts con sidebar | Modificar | Enlace "Turnos" en nav |

---

## 12. Notas Técnicas

- **Compatibilidad de datos:** El campo `shift_id` en Employee es opcional (`default: null`). Empleados sin turno asignado siguen funcionando con `work_schedule` individual.
- **hoursEngine.js:** Las funciones son puras (sin efectos secundarios, sin acceso a BD). Se pueden importar tanto en rutas del servidor como copiar en el frontend sin modificaciones.
- **EmailJS:** Se ejecuta exclusivamente en el navegador. No requiere configuración en el servidor. Las credenciales (serviceId, templateId, publicKey) se definen como constantes en el frontend.
- **Polling de notificaciones:** En lugar de WebSockets, el frontend del empleado puede sondear `GET /api/notifications/unread-count` cada 60 segundos para actualizar el badge. Suficiente para el caso de uso actual.
- **Exportar PDF en turnos.html:** Usar `jsPDF + autoTable` igual que en el prototipo. Verificar si ya está en el bundle del proyecto; si no, añadir vía CDN.
- **Sin migraciones destructivas:** Todos los cambios son aditivos. No se elimina ni renombra ningún campo existente.
```
