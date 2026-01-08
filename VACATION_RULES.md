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
- `carryover_days`: días arrastrados de otros años.
  - Estado actual: se toman de `Employee.vacation_carryover_days` (campo imputable manualmente en Gestión de empleados).
  - Se consumen primero (FIFO) cuando se solicita/aprueba una vacación.
- `allowance_days`: total asignado = `base_allowance_days + carryover_days`.
- `approved_days`: suma de solicitudes `approved` dentro del año.
- `pending_days`: suma de solicitudes `pending` dentro del año.
- `rejected_days`: suma de solicitudes `rejected` dentro del año.

Campos derivados:

- `remaining_after_approved = max(0, allowance_days - approved_days)`
- `remaining_after_pending = max(0, allowance_days - approved_days - pending_days)`

Notas importantes:

- El consumo de vacaciones se registra en `Vacation.allocation`:
  - `allocation.carryover_days`: días consumidos del carryover (años anteriores).
  - `allocation.current_year_days`: días consumidos del año vigente.
- Para compatibilidad con solicitudes antiguas sin `allocation`, el sistema puede usar `Vacation.days` como fallback.

### 4.1) Rollover anual (días no consumidos → carryover)

Para que al cambiar de año no se pierdan los días no consumidos, existe un proceso de rollover que:

- Calcula los días no consumidos del año anterior (en base a días anuales del empleado, vacaciones aprobadas imputadas a ese año y ausencias que descuentan vacaciones).
- Suma esos días al campo `Employee.vacation_carryover_days`.
- Usa `Settings.vacation_carryover_last_rollover_year` para evitar ejecutar el rollover dos veces.
- Genera un `AuditLog` por empleado afectado (acción `vacation_rollover`).

Ejecución manual:

- `npm run vacation:rollover -- --year=2025`
- `npm run vacation:rollover -- --year=2025 --dry-run`
- `npm run vacation:rollover -- --year=2025 --force`

Ejecución automática (scheduler opcional):

- `npm run vacation:rollover:schedule`
- Variables de entorno:
  - `VACATION_ROLLOVER_CRON` (por defecto `10 0 1 1 *` → 00:10 del 1 de enero)
  - `VACATION_ROLLOVER_RUN_ON_START=true` (ejecuta una vez al arrancar)
  - `VACATION_ROLLOVER_DRY_RUN=true`
  - `VACATION_ROLLOVER_FORCE=true`

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
