# Guía de backups y restauración

Esta app soporta backups tanto de **MongoDB** (modo actual) como de **SQLite** (modo legacy).

## Variables de entorno

- `BACKUP_DIR` (opcional): carpeta base de backups (por defecto: `./backups`).
- `BACKUP_KEEP` (opcional): cuántos backups conservar por tipo (por defecto: `30`).

**MongoDB**
- `MONGODB_URI`: si está definida, `npm run backup` hará backup de Mongo por defecto.

**SQLite (legacy)**
- `DB_PATH` (opcional): ruta del fichero sqlite (por defecto: `./data/employees.db`).

## Crear backup

### MongoDB (recomendado)

- `npm run backup:mongo`

Qué genera:
- Carpeta `backups/mongo/<timestamp>/`
- Un fichero `<Model>.jsonl` por modelo (JSON por línea)
- `manifest.json` con metadatos
- `checksums.json` si se usa `--verify=true`

### SQLite (legacy)

- `npm run backup:sqlite`

Qué genera:
- Carpeta `backups/sqlite/<timestamp>/employees.db`

## Restaurar backup (guiado)

### MongoDB

- `npm run restore:mongo`

Flujo de seguridad:
- (Por defecto) crea un **backup de seguridad** de Mongo antes de restaurar.
- Opción para desactivar: `node scripts/restore.js --type=mongo --no-safety=true`

Verificación (recomendado):
- `node scripts/restore.js --type=mongo --verify=true`

Confirmación:
- Debes escribir exactamente: `RESTAURAR MONGO`

### SQLite (legacy)

- `npm run restore`

Selecciona un backup:
- Soporta backups legacy `./backups/*.db`
- Soporta backups nuevos `./backups/sqlite/<timestamp>/employees.db`

## Programar backups (rotación automática)

La app incluye un proceso scheduler basado en cron.

1) Instala dependencias:
- `npm install`

2) Ejecuta el scheduler:
- `npm run backup:schedule`

Variables:
- `BACKUP_CRON` (por defecto `0 3 * * *` → 03:00 diario)
- `BACKUP_TYPE` (opcional: `mongo` o `sqlite`; vacío = auto)
- `BACKUP_VERIFY` (por defecto `true`)
- `BACKUP_RUN_ON_START` (`true` para ejecutar un backup al arrancar el scheduler)

Notas:
- En entornos serverless (p.ej. Vercel) no tiene sentido ejecutar un scheduler dentro de la app.
- En Windows se recomienda correr `npm run backup:schedule` como servicio (Task Scheduler, NSSM, PM2, etc.).

## Prueba de restauración en entorno de test

Recomendación:
- Usa un `MONGODB_URI` de **staging**.
- Restaura y valida que el login y las pantallas principales cargan datos.
