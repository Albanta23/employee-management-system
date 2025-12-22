# Plan de mejoras (propuestas)

Fecha: 23/12/2025

Este documento recoge un plan de implementación por bloques para hacer la aplicación más completa, robusta y operativa en el día a día.

## Principios

- Implementar por fases (entregables pequeños y verificables).
- Mantener consistencia de reglas en todas las pantallas (web admin + portal empleado + exportaciones).
- Priorizar: control real, trazabilidad y evitar errores de gestión.

## Fase 1 — Base funcional (MVP+) 

### 1) Reglas de vacaciones (definición y parámetros)

**Objetivo**: que el cálculo de vacaciones esté definido y sea consistente.

**Acciones**
- Documentar reglas objetivo: cálculo de días (naturales/laborables), prorrateo por fecha de alta, cambios de jornada, cambios de “días/año”.
- Definir arrastre entre años y caducidad: “se pueden pasar X días”, “caducan el dd/mm”.
- Decidir qué reglas dependen de convenio/ubicación y cuáles son globales.

**Entregable**
- Documento de reglas + parámetros configurables.

**Criterio de aceptación**
- Cualquier pantalla de saldo muestra el mismo criterio.

### 2) Validaciones y solapamientos (evitar errores)

**Objetivo**: impedir solicitudes inconsistentes.

**Acciones**
- Backend: bloquear solapamientos entre solicitudes de vacaciones/permisos/bajas para el mismo empleado.
- Validar rangos, estados y coherencia de días.
- Frontend: mensajes claros cuando se rechaza por solape.

**Criterio de aceptación**
- No se pueden crear intervalos que se pisen.

### 3) Estados completos de solicitudes

**Objetivo**: reflejar el ciclo real de una solicitud.

**Acciones**
- Ampliar estados si aplica: `cancelled` (cancelada), `revoked` (revocada), además de `pending/approved/rejected`.
- Motivo obligatorio en rechazos.
- Ajustar UI en: vacaciones, solicitudes del empleado y reportes.

**Criterio de aceptación**
- Una solicitud puede cancelarse (si está pendiente) y queda trazada.

### 4) Aprobaciones por rol y alcance (scope)

**Objetivo**: que cada rol solo haga lo que debe.

**Acciones**
- Endurecer permisos: admin/RRHH/coordinador/empleado.
- Alcance por tienda/ubicación (quién puede aprobar a quién).
- Tests básicos de autorización en endpoints críticos.

**Criterio de aceptación**
- Un coordinador no puede aprobar solicitudes fuera de su scope.

## Fase 2 — Operación y visión de equipo

### 5) Calendario por tienda y “vista equipo”

**Objetivo**: planificar cobertura y visualizar ausencias.

**Acciones**
- Endpoint y/o ampliación de calendario agregado por ubicación.
- Pantalla simple de planificación: quién está fuera por día.
- Filtros por ubicación y rango.

**Criterio de aceptación**
- Se puede ver el calendario de una tienda para un mes.

### 6) Saldo anual avanzado (prorrateo + carryover)

**Objetivo**: saldo real por año, con reglas completas.

**Acciones**
- Backend: saldo por año con prorrateo y arrastre.
- Exponer campos claros:
  - asignadas
  - disfrutadas (aprobadas)
  - pendientes
  - disponibles (según criterio)
  - disponibles_con_pendientes (si se quiere mostrar)
- Frontend: mostrar definiciones y consistencia.

**Criterio de aceptación**
- El saldo coincide con las reglas definidas en la Fase 1.

## Fase 3 — Trazabilidad, reporting y robustez

### 7) Auditoría de acciones (quién hizo qué)

**Objetivo**: trazabilidad completa para RRHH.

**Acciones**
- Modelo/colección `AuditLog`.
- Registrar eventos: create/update/approve/reject/cancel en vacaciones; cambios relevantes de empleado; cambios de horario.
- (Opcional) UI: tabla de auditoría por empleado.

**Criterio de aceptación**
- Se puede ver el historial de acciones con usuario y timestamp.

### 8) Historial de cambios en ficha del empleado

**Objetivo**: entender cambios en datos críticos.

**Acciones**
- Guardar “diff” o resumen: salario, ubicación, vacaciones/año, horario.
- UI en ficha: sección “Historial”.

**Criterio de aceptación**
- Cada cambio deja un registro consultable.

### 9) Reportes de gestión (admin)

**Objetivo**: informes útiles y accionables.

**Acciones (ejemplos)**
- Consumo de vacaciones por año/empleado.
- Absentismo por causa.
- Resumen mensual por tienda.
- Ranking de horas extra.

**Exportación**
- PDF y (opcional) CSV/Excel.

**Criterio de aceptación**
- Reportes con filtros por fechas y ubicación.

### 10) Exportaciones consistentes

**Objetivo**: que exportar sea fiable y uniforme.

**Acciones**
- Normalizar columnas y totales.
- Asegurar que lo exportado coincide con lo que se ve.
- Revisión de utilidades y páginas que exportan.

**Criterio de aceptación**
- Exportar siempre incluye los campos clave.

### 11) Backups automáticos y restauración guiada

**Objetivo**: seguridad operativa.

**Acciones**
- Backups programados con rotación.
- Comprobación de integridad.
- Procedimiento de restauración guiado y seguro.

**Criterio de aceptación**
- Se puede restaurar un backup en entorno de prueba sin pérdida.

### 12) Observabilidad y estabilidad

**Objetivo**: poder operar y diagnosticar rápido.

**Acciones**
- Endpoint `/health`.
- Logs estructurados.
- Captura de errores del servidor.
- Métricas mínimas (requests/errores).

**Criterio de aceptación**
- Diagnóstico rápido ante fallos y caídas.

## Recomendación de priorización (rápida)

- Si el problema principal es gestión diaria: 2 → 4 → 5
- Si el problema principal es saldo correcto: 1 → 6 → 2
- Si el problema principal es “quién tocó qué”: 7 → 8
- Si el problema principal es dirección/controlling: 9 → 10
