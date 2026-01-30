# Sistema FIFO para Descuento de Días de Vacaciones

## Principio

Los días de vacaciones se descuentan en este orden:
1. **Primero**: Días de otros años (`Employee.vacation_carryover_days`)
2. **Segundo**: Días del año vigente (asignación anual - consumo actual)

## Flujo Implementado

### 1. Crear Solicitud de Vacaciones (Empleado)

```javascript
// Ejemplo: Empleado con 10 días de carryover + 20 días disponibles del año actual
// Solicita 15 días

const carryoverAvailable = 10;           // vacation_carryover_days
const remainingCurrentYear = 20;          // base_allowance - consumo_actual
const daysRequested = 15;

// Cálculo FIFO
const carryoverToUse = Math.min(carryoverAvailable, daysRequested); // min(10, 15) = 10
const currentYearToUse = daysRequested - carryoverToUse;             // 15 - 10 = 5

// Asignación guardada en Vacation.allocation
{
  carryover_days: 10,
  current_year_days: 5
}

// Reserva inmediata
Employee.vacation_carryover_days -= 10;  // Ahora: 0 (reservado)
```

### 2. Editar Solicitud Pendiente (Admin o Empleado)

```javascript
// Solicitud ANTERIOR: 15 días (10 carryover + 5 año actual)
// ACTUALIZACIÓN: aumentar a 18 días

// Paso 1: Liberar la reserva anterior
Employee.vacation_carryover_days += 10; // Ahora: 10

// Paso 2: Recalcular con nueva cantidad
const carryoverAvailable = 10;
const remainingCurrentYear = 20 - 5 = 15; // Restar el 5 que ya estaba asignado del año
const daysRequested = 18;

// Cálculo FIFO nuevamente
const carryoverToUse = Math.min(10, 18) = 10;
const currentYearToUse = 18 - 10 = 8;

// Paso 3: Reservar el nuevo carryover
Employee.vacation_carryover_days -= 10; // Ahora: 0 (reservado)

// Actualizar allocation
{
  carryover_days: 10,
  current_year_days: 8
}
```

### 3. Aprobar Solicitud (Admin)

Si una solicitud sin `allocation` (legacy) se aprueba, se calcula FIFO en ese momento:

```javascript
// Solicitud pendiente SIN allocation (creada antes de implementar FIFO)
// 15 días solicitados

// Cálculo al aprobar
const carryoverAvailable = 10;
const remainingCurrentYear = 20;
const carryoverToUse = Math.min(10, 15) = 10;
const currentYearToUse = 5;

// Se asigna y reserva carryover
{
  allocation: {
    carryover_days: 10,
    current_year_days: 5
  }
}
```

### 4. Cancelar/Rechazar Solicitud (Admin o Empleado)

```javascript
// Al rechazar/cancelar una solicitud pendiente,
// se libera el carryover reservado

const reservedCarry = existing.allocation.carryover_days; // 10
Employee.vacation_carryover_days += reservedCarry;        // Devolver al empleado
```

## Garantías

- ✅ **Nunca se sobreasingna carryover**: Se reserva inmediatamente al crear/editar
- ✅ **FIFO consistente**: Todas las operaciones siguen primero carryover, luego año actual
- ✅ **Sin doble conteo**: Al editar, se libera la reserva previa antes de recalcular
- ✅ **Trazabilidad**: Cada `Vacation` tiene `allocation` con desglose claro
- ✅ **Retrocompatibilidad**: Solicitudes sin `allocation` se calculan al aprobar

## Campos Clave en DB

### Employee
```javascript
{
  vacation_carryover_days: 10,  // Días acumulados de años anteriores (sin reservar)
  annual_vacation_days: 30      // Asignación base anual
}
```

### Vacation
```javascript
{
  days: 15,                      // Total de días
  allocation: {
    carryover_days: 10,          // Consumidos de años anteriores
    current_year_days: 5         // Consumidos del año vigente
  },
  status: 'pending'              // pending | approved | rejected | cancelled | revoked
}
```

## API Response (Balance de Empleado)

```json
{
  "vacation": {
    "base_allowance_days": 30,
    "carryover_days": 10,
    "approved_days": 5,          // Vacaciones aprobadas este año
    "pending_days": 15,          // Vacaciones pendientes (en proceso)
    "remaining_after_approved": 25,
    "remaining_after_pending": 10
  }
}
```

---

**Última actualización**: 2026-01-30  
**Responsable**: Sistema de Vacaciones v2.0
