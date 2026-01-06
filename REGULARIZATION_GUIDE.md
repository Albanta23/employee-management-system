# Guía de Regularización de Fichajes

## 📋 Descripción

La funcionalidad de **Regularización de Fichajes** permite a los administradores y coordinadores ajustar automáticamente los horarios de entrada, salida y descansos de los empleados según el horario configurado en su perfil.

## ✨ Características Principales

- ✅ **Ajuste automático** de timestamps según horario configurado
- ✅ **Mantiene la geolocalización** original de los fichajes
- ✅ **Preserva los datos** del dispositivo y otros metadatos
- ✅ **Registro de auditoría** completo de cada regularización
- ✅ **Respeta overrides** de horarios especiales (sábados, festivos, excepciones)

## 🔒 Permisos Requeridos

- **Administrador**: Acceso completo a todos los empleados
- **Coordinador**: Solo puede regularizar empleados de sus ubicaciones asignadas

## 🎯 ¿Cuándo Usar Esta Funcionalidad?

### Casos de Uso Válidos:
- Empleado olvidó fichar a tiempo pero sí trabajó
- Ajuste de horas extras a jornada normal contractual
- Corrección de errores en fichajes manuales
- Regularización para cumplimiento de convenio colectivo

### ⚠️ No Usar Para:
- Crear fichajes ficticios de días no trabajados
- Ocultar incumplimientos de horario graves
- Modificar días de vacaciones o bajas médicas

## 🛠️ Cómo Usar

### Desde el Portal de Administración

1. **Acceder al Control Horario**
   - Ir a `Control Horario` en el menú lateral
   - Aplicar filtros por fecha y/o empleado

2. **Localizar el Día a Regularizar**
   - Los fichajes se agrupan por fecha y empleado
   - Cada grupo muestra un botón **⚖️ Regularizar**

3. **Revisar Información**
   - El modal muestra:
     - Nombre del empleado
     - Fecha a regularizar
     - Horario configurado que se aplicará

4. **Confirmar Regularización**
   - Clic en **✓ Confirmar Regularización**
   - El sistema ajustará automáticamente los timestamps

## 📊 Qué se Ajusta

### Entrada (in)
- Se ajusta al `start_time` del horario configurado
- Solo se modifica el **primer** fichaje de entrada del día

### Salida (out)
- Se ajusta al `end_time` del horario configurado
- Solo se modifica el **último** fichaje de salida del día

### Descansos
- **break_start**: Se ajusta al horario de inicio de descanso
- **break_end**: Se ajusta al horario de fin de descanso
- Solo si están configurados en el horario

## 🔍 Qué se Mantiene Intacto

- ✅ Latitud y Longitud (geolocalización)
- ✅ Información del dispositivo
- ✅ IP del registro
- ✅ Store name (si aplica)
- ✅ Notas del fichaje
- ✅ ID del registro

## 📝 Registro de Auditoría

Cada regularización se registra automáticamente en el sistema de auditoría con:

```javascript
{
  action: 'attendance.regularize',
  entityType: 'Attendance',
  employeeId: '...',
  before: [
    { type: 'in', timestamp: '2026-01-06T10:15:00Z', _id: '...' },
    { type: 'out', timestamp: '2026-01-06T19:30:00Z', _id: '...' }
  ],
  after: [
    { type: 'in', timestamp: '2026-01-06T09:00:00Z', _id: '...' },
    { type: 'out', timestamp: '2026-01-06T18:00:00Z', _id: '...' }
  ],
  meta: {
    date: '2026-01-06',
    updatesCount: 2,
    schedule: {
      start_time: '09:00',
      end_time: '18:00',
      break_start: null,
      break_end: null
    }
  }
}
```

## 🔧 API Técnica

### Endpoint
```
POST /api/attendance/regularize/:employeeId/:date
```

### Parámetros
- `employeeId`: ID del empleado (MongoDB ObjectId)
- `date`: Fecha en formato YYYY-MM-DD

### Respuesta Exitosa
```json
{
  "message": "Fichajes regularizados correctamente",
  "updates": [
    {
      "type": "in",
      "from": "2026-01-06T10:15:00.000Z",
      "to": "2026-01-06T09:00:00.000Z"
    },
    {
      "type": "out",
      "from": "2026-01-06T19:30:00.000Z",
      "to": "2026-01-06T18:00:00.000Z"
    }
  ],
  "date": "2026-01-06",
  "employee": "Juan Pérez"
}
```

### Errores Posibles
- `400`: Empleado sin horario configurado
- `400`: Día no laborable según horario
- `400`: No hay fichajes para ese día
- `404`: Empleado no encontrado
- `403`: Sin permisos de acceso

## ⚙️ Configuración del Horario

Para que la regularización funcione, el empleado debe tener configurado su horario en el perfil:

```javascript
{
  work_schedule: {
    enabled: true,
    days_of_week: [1, 2, 3, 4, 5], // L-V
    start_time: "09:00",
    end_time: "18:00",
    break_start: "14:00", // Opcional
    break_end: "15:00",   // Opcional
    tolerance_minutes: 10,
    
    // Override para sábados (opcional)
    day_overrides: {
      "6": {
        enabled: true,
        start_time: "09:00",
        end_time: "14:00"
      }
    },
    
    // Excepciones puntuales (opcional)
    date_overrides: [
      {
        date: "2026-01-06",
        enabled: true,
        start_time: "10:00",
        end_time: "15:00"
      }
    ]
  }
}
```

## 🎨 Interfaz de Usuario

### Botón de Regularización
- Aparece en cada grupo de fichajes
- Color naranja distintivo
- Icono: ⚖️

### Modal de Confirmación
- Muestra información clara del ajuste
- Advertencia sobre el cambio
- Botones de Cancelar/Confirmar

## 📱 Compatibilidad

- ✅ Portal Web de Administración
- ✅ Responsive (móvil y tablet)
- ✅ Todos los navegadores modernos

## 🔐 Seguridad

- ✅ Requiere autenticación con token JWT
- ✅ Verifica permisos de `attendance` feature
- ✅ Aplica scope de ubicación para coordinadores
- ✅ Registra quién realizó la regularización
- ✅ Mantiene historial completo en audit log

## 📈 Mejores Prácticas

1. **Revisar antes de regularizar**: Verificar que el horario configurado sea correcto
2. **Documentar**: Añadir notas en el sistema si es necesario
3. **Comunicar**: Informar al empleado sobre la regularización
4. **Auditar**: Revisar periódicamente el log de regularizaciones
5. **No abusar**: Usar solo cuando sea realmente necesario

## 🐛 Solución de Problemas

### "El empleado no tiene horario configurado"
- **Solución**: Ir al perfil del empleado y configurar su horario en "Mi horario"

### "Este día no es laborable según el horario configurado"
- **Solución**: Verificar los días laborables o añadir una excepción para esa fecha específica

### "No hay fichajes para este día"
- **Solución**: El empleado debe haber realizado al menos un fichaje en ese día

### La regularización no aparece reflejada
- **Solución**: Recargar la página con F5 o volver a aplicar los filtros

## 📞 Soporte

Para más información o reportar problemas:
- Revisar el log de auditoría en `/api/audit-log`
- Consultar los logs del servidor
- Verificar la configuración del horario del empleado

---

**By JCF2025DV** | Sistema de Gestión de Empleados
