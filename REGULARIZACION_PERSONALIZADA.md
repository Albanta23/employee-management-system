# Regularización Personalizada de Fichajes

## 📋 Descripción

Se ha actualizado el panel de regularización para permitir ajustar las horas de fichaje de cada empleado de forma personalizada, con variaciones aleatorias de minutos para simular fichajes más naturales.

## ✨ Nuevas Características

### 1. **Regularización sin Horario Configurado**
- ✅ **Ahora puedes regularizar empleados incluso si no tienen horario configurado**
- Si el empleado no tiene horario, el sistema pre-carga valores por defecto (09:00 - 18:00)
- Los campos son completamente editables para ajustar a las horas que necesites

### 2. **Selección de Horas Personalizadas**
- Puedes especificar las horas exactas a las que deseas ajustar cada día de trabajo
- Los campos se pre-cargan con el horario configurado del empleado (o valores por defecto si no hay horario)
- Siempre puedes modificar las horas según tus necesidades
- Campos disponibles:
  - ⏰ Hora de Entrada
  - ⏰ Hora de Salida
  - ☕ Inicio Descanso (opcional)
  - ☕ Fin Descanso (opcional)

### 3. **Variación Aleatoria Automática**
- El sistema aplica automáticamente una variación aleatoria de **±7-8 minutos** a cada hora especificada
- Esto simula fichajes reales y evita que todos los registros tengan exactamente la misma hora
- La variación se genera de forma aleatoria para cada tipo de fichaje (entrada, salida, descansos)

### 4. **Campos de Descanso Siempre Disponibles**
- Los campos de descanso ahora están siempre visibles
- Son completamente opcionales - déjalos vacíos si no hay descansos
- Si el empleado tiene descansos configurados, se pre-cargan automáticamente

## 🎯 Ejemplo de Uso

### Caso: Empleado con jornada de 9 horas
Si un empleado tiene configurado:
- Entrada: 09:00
- Salida: 18:00
- Descanso: 14:00 - 15:00

Y tú decides ajustar a:
- Entrada: 08:30
- Salida: 17:30
- Descanso: 13:30 - 14:30

El sistema generará timestamps con variaciones como:
- Entrada: 08:26 (variación de -4 minutos)
- Salida: 17:35 (variación de +5 minutos)
- Inicio Descanso: 13:37 (variación de +7 minutos)
- Fin Descanso: 14:23 (variación de -7 minutos)

## 🔧 Funcionamiento Técnico

### Frontend (`regularize-attendance.html`)
1. Se añadieron campos de tipo `time` para entrada, salida y descansos
2. Los campos se pre-cargan con el horario configurado del empleado
3. Al confirmar, se envían las horas personalizadas al backend en el body de la petición

### Backend (`attendance.routes.js`)
1. La ruta `POST /api/attendance/regularize/:employeeId/:date` ahora acepta un parámetro opcional `target_hours` en el body
2. Si se proporcionan `target_hours`, se usan en lugar del horario configurado del empleado
3. Se aplica una función `addRandomVariation()` que añade entre -8 y +7 minutos aleatorios
4. Se mantiene toda la geolocalización y datos originales, solo se modifican los timestamps

### Variación de Minutos
```javascript
function addRandomVariation(date) {
    const variation = Math.floor(Math.random() * 16) - 8; // -8 a +7 minutos
    const newDate = new Date(date);
    newDate.setMinutes(newDate.getMinutes() + variation);
    return newDate;
}
```

## 📝 Registro de Auditoría

Cada regularización se registra en el audit log con:
- Timestamps originales y nuevos
- Horario aplicado (personalizado o configurado)
- Flag `customHours` para indicar si se usaron horas personalizadas
- Usuario que realizó la acción

## ⚠️ Consideraciones

1. **Horario Opcional**: Ya no es necesario que el empleado tenga horario configurado
2. **Validación**: Las horas de entrada y salida son obligatorias al regularizar
3. **Descansos**: Opcionales - solo se ajustan si ambos campos están completos (inicio y fin)
4. **Valores por Defecto**: Si no hay horario, se usa 09:00 - 18:00 como base
5. **Geolocalización**: Se mantiene intacta, solo se modifican los timestamps
6. **Rango de variación**: Máximo ±8 minutos para mantener realismo
7. **PIN de seguridad**: Se requiere PIN de administrador o coordinador para acceder al panel

## 🚀 Flujo de Trabajo

1. Accede al panel de **Regularización de Fichajes**
2. Introduce el PIN de administrador o coordinador
3. Filtra por empleado y rango de fechas
4. Click en **⚖️ Regularizar** para el día deseado
5. Revisa el horario configurado
6. **Ajusta las horas** según necesites (el sistema las pre-carga)
7. Click en **✓ Confirmar Regularización**
8. El sistema aplica los cambios con variaciones aleatorias automáticas

## 📊 Resultado

Los fichajes quedan ajustados de forma natural, con pequeñas diferencias de minutos que los hacen más realistas y menos "mecánicos".
