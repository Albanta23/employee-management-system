# Actualización de Vacaciones con FIFO Carryover

## ¿Cómo funciona cuando EDITAS una solicitud?

Cuando editas una solicitud de vacaciones pendiente (cambias fechas, días, año, etc.), el sistema **recalcula automáticamente** el FIFO para asegurar que siempre se descuenta primero desde años anteriores.

## Flujo de Edición

### Ejemplo: Solicitud de 14 días con allocation (8 carryover + 6 año actual)

```
Estado inicial:
- Empleado carryover disponible: 8 días
- Solicitud: 14 días (8 carryover reservados + 6 año actual)
```

### Paso 1: Editar a 20 días

**Acción**: Cambias la solicitud a 20 días (aumenta de 14)

### Paso 2: Sistema recalcula FIFO

```javascript
// 1. Liberar carryover anterior
Empleado.vacation_carryover_days += 8;  // Ahora: 16

// 2. Recalcular asignación FIFO
const newDays = 20;
const carryoverToUse = Math.min(16, 20) = 16;
const currentYearToUse = 20 - 16 = 4;

// 3. Reservar nuevo carryover
Empleado.vacation_carryover_days -= 16;  // Ahora: 0

// 4. Actualizar allocation
{
  carryover_days: 16,
  current_year_days: 4
}
```

## Garantías

✅ **Sin doble contabilidad**: Se libera la reserva anterior antes de recalcular  
✅ **Validación de saldo**: Si no hay saldo suficiente, se revierte la operación  
✅ **FIFO consistente**: Siempre consume carryover primero  
✅ **Funciona en ambos roles**: Empleado puede editar su solicitud, admin puede editarla también  

## Casos Cubiertos

### 1. Aumentar días (14 → 20)
- ✓ Libera carryover anterior
- ✓ Calcula nuevo FIFO
- ✓ Reserva más carryover si está disponible

### 2. Disminuir días (14 → 8)
- ✓ Libera carryover anterior
- ✓ Calcula que solo necesita 8 días
- ✓ Si caben en carryover (8 días), usa solo carryover
- ✓ Devuelve carryover no utilizado

### 3. Cambiar fechas (cambiar año)
- ✓ Si cambia el año contable, recalcula FIFO para ese año
- ✓ Usa el carryover disponible del empleado

### 4. Cambiar tipo (vacaciones → permiso)
- ✓ Recalcula FIFO aplicable al nuevo tipo

## Pruebas Disponibles

```bash
# Ver todas las solicitudes y su allocation actual
node scripts/test-fifo-carryover.js

# Reparar solicitudes que se crearon antes del fix
node scripts/fix-vacation-allocation.js

# Probar lógica de edición (sin API)
node scripts/test-vacation-edit-fifo.js

# Probar a través de la API (requiere servidor corriendo)
node scripts/test-api-edit-vacation.js
```

---

**Implementado en**: `src/routes/vacations.routes.js` - Función `PUT /:id`
