# Reglas de vacaciones y permisos (estado actual)

Fecha: 24/12/2025

Este documento describe **cómo calcula y valida actualmente** la app las solicitudes de vacaciones/permisos y su saldo.

## 1) Tipos de solicitud

Las solicitudes de tiempo libre se guardan en el modelo `Vacation`:

- `type = vacation` → Vacaciones.
- `type = personal | compensatory` → Permisos/ausencias (misma tabla/colección).

## 2) Estados del ciclo de vida

Estados soportados:

- `pending` (pendiente)
- `approved` (aprobada)
- `rejected` (rechazada) → requiere `rejection_reason`
- `cancelled` (cancelada)
- `revoked` (revocada)

Transiciones permitidas:

- `pending` → `approved` | `rejected` | `cancelled`
- `approved` → `revoked`

## 3) Cálculo de días (vacaciones)

La app calcula automáticamente `days` al crear una solicitud de vacaciones o al modificar sus fechas si está `pending`.

Regla actual en backend: [src/utils/dateUtils.js](src/utils/dateUtils.js)

- Cuenta los días **incluyendo fines de semana**.
- **Excluye festivos** (nacionales siempre + locales cuando `holiday.location` coincide con la `location` del empleado).
- El rango es **inclusivo** (se cuentan inicio y fin).

Nota: el texto del comentario en el código menciona fines de semana, pero la implementación actual **no los excluye**.

## 4) Saldo anual (vacaciones)

El saldo se calcula por año natural:

- `annual_vacation_days`: se toma de `Employee.annual_vacation_days` (si no existe, se usa 30).
- `base_allowance_days`:
  - Si el prorrateo está desactivado: coincide con `annual_vacation_days`.
  - Si el prorrateo está activado: se prorratea por días de empleo dentro del año usando:
    - `Employee.hire_date` (inicio)
    - `Employee.termination_date` (fin, si aplica)
    - Se redondea al incremento configurado (por defecto 0.5).
- `carryover_days` (si está activo): días arrastrados del año anterior (no disfrutados) hasta un máximo.
- `allowance_days`: total asignado (compatibilidad) = `base_allowance_days + carryover_days`.
- `approved_days`: suma de solicitudes `approved` dentro del año.
- `pending_days`: suma de solicitudes `pending` dentro del año.
- `rejected_days`: suma de solicitudes `rejected` dentro del año.

Campos derivados:

- `remaining_after_approved = max(0, allowance_days - approved_days)`
- `remaining_after_pending = max(0, allowance_days - approved_days - pending_days)`

Notas importantes:

- El cálculo de carryover usa el año anterior como: `unused = max(0, prev_allowance - prev_approved)`.
- Por ahora no se reparte “por fecha” el consumo del carryover (no se descuenta primero/según caducidad). La API devuelve `carryover_expiry_month_day` para informar/mostrar en UI.

## 5) Validación de solapes (backend)

La app impide crear/modificar rangos que se solapen (intersección inclusiva) según reglas configurables.

Regla general:

- Solo se consideran como “bloqueantes” las solicitudes `Vacation` en `pending` o `approved`.
- En `Absence`, se consideran rangos activos/cerrados y también bajas activas con `end_date` vacío.

Configuración:

- Las combinaciones que bloquean (Vacaciones↔Vacaciones, Vacaciones↔Permisos, Vacaciones↔Bajas, etc.) se gestionan en Configuración.
- Hay dos niveles:
  - Global: `Settings.overlap_rules` (aplica por defecto a todas las tiendas).
  - Por tienda/ubicación: `Settings.overlap_rules_by_location[Employee.location]` (si existe override, se usa ese).

En caso de solape, la API responde con **409 Conflict**.

## 6) Parámetros configurables implicados

- Por empleado:
  - `annual_vacation_days`
  - `location` (impacta en festivos locales)
  - `hire_date` (prorrateo)
  - `termination_date` (prorrateo)

- Política global (Settings):
  - `Settings.vacation_policy.proration_enabled`
  - `Settings.vacation_policy.proration_rounding_increment`
  - `Settings.vacation_policy.carryover_enabled`
  - `Settings.vacation_policy.carryover_max_days`
  - `Settings.vacation_policy.carryover_expiry_month_day`

- Festivos:
  - `Holiday.type = national | local`
  - `Holiday.location` (si es festivo local)

---

## Pendientes de definición (plan Fase 1.1)

Aún no están formalizadas/implementadas reglas de:

- Ajustar el prorrateo/carryover a reglas de negocio exactas (convenio/ubicación) si aplica.
- Cambios de jornada o cambios de “días/año” intra-año.
- Distinción “naturales vs laborables” (y si se excluyen fines de semana).
