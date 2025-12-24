# Auditoría (AuditLog)

Fecha: 24/12/2025

Este documento describe la auditoría implementada (Fase 3.7).

## Objetivo

Registrar acciones críticas (quién hizo qué y cuándo) sin bloquear la operación principal.

## Modelo

Colección: `AuditLog`

Campos principales:

- `created_at`
- `actor`: `{ user_id, username, role }`
- `action`: string (p.ej. `timeoff.approve`)
- `entity`: `{ type, id }`
- `employee`: `{ id, location }`
- `before` / `after`: snapshot/datos relevantes
- `meta`: información adicional (diff simple, flags)

## Acciones registradas

- Vacaciones/Permisos (`Vacation`)
  - `timeoff.create`
  - `timeoff.update`
  - `timeoff.approve`
  - `timeoff.reject`
  - `timeoff.cancel`
  - `timeoff.revoke`

- Empleados (`Employee`)
  - `employee.self_update` (email/teléfono/horario)
  - `employee.update` (admin/coordinador en scope)
  - `employee.deactivate`

- Configuración (`Settings`/`User`)
  - `settings.overlap_rules.update`
  - `settings.vacation_policy.update`
  - `settings.branding.update`
  - `settings.store_coordinator.update`
  - `settings.admin_credentials.update` (sin guardar contraseñas)

## Consulta

Endpoint:

- `GET /api/audit?employee_id=&entity_type=&entity_id=&action=&limit=`

Notas:

- Requiere rol `admin` o, para `store_coordinator`, acceso a `reports` o `employees`.
- Coordinador: si no se filtra por `employee_id`, queda limitado automáticamente a empleados en su scope.

## Seguridad

- La auditoría no guarda contraseñas.
- Fallos de auditoría no bloquean la operación principal.
