# Reparación de Saldo de Vacaciones en Producción

## Problema

En producción sigue mostrando incorrectamente el saldo de vacaciones porque las solicitudes creadas **antes** del fix FIFO tienen `allocation` incorrecta:
- `carryover_days: 0` 
- `current_year_days: (todos los días)`

Debería ser:
- `carryover_days: (días de años anteriores)`
- `current_year_days: (días del año actual)`

## Solución

### Opción 1: Ejecutar en servidor (SSH)

Si tienes acceso SSH al servidor de producción:

```bash
cd /ruta/a/employee-management-system

# Ejecutar el script de reparación
node scripts/fix-vacation-allocation-prod.js
```

### Opción 2: Ejecutar localmente con BD remota

```bash
# En tu máquina local, con el MONGODB_URI de producción
MONGODB_URI="mongodb+srv://usuario:contraseña@cluster.mongodb.net/database?retryWrites=true" \
node scripts/fix-vacation-allocation-prod.js
```

### Opción 3: Desde Docker (si está containerizado)

```bash
docker exec -e MONGODB_URI="<tu_url_produccion>" <nombre_contenedor> \
  node scripts/fix-vacation-allocation-prod.js
```

## Qué hace el script

1. ✓ Se conecta a la BD de producción
2. ✓ Busca todas las solicitudes con `allocation` incorrecta
3. ✓ Recalcula el FIFO usando el carryover disponible del empleado
4. ✓ Actualiza la `allocation` en cada solicitud
5. ✓ Muestra un reporte detallado

## Ejemplo de output

```
🔧 Reparando asignaciones FIFO en producción...
📍 Base de datos: cluster0.mongodb.net

✓ Conectado a MongoDB

Analizando 47 solicitudes...

📊 RESULTADOS:

Reparadas:
  • 697ca3b4138 - AMAYA MARIA REDONDO BERMEJO
    14 días: carryover 0→8, actual 14→6
  • 5f8ac9d2156 - JUAN PÉREZ GARCÍA
    10 días: carryover 0→5, actual 10→5

Total reparadas: 2
Total sin cambios: 45

✓ Proceso completado
```

## Verificación

Después de ejecutar el script, verifica que el saldo se muestra correctamente:

1. Entra al portal como empleado
2. Verifica que aparece:
   - "Años anteriores (pendientes): X días"
   - "Año en vigor: Y días"
3. El total debe ser correcto

## Notas importantes

⚠️ **Hacer backup antes de ejecutar en producción**

```bash
# Backup de la BD
mongodump --uri "mongodb+srv://usuario:pass@cluster.mongodb.net/database" \
  --out ./backup_vacaciones_$(date +%Y%m%d_%H%M%S)
```

---

**Script**: `scripts/fix-vacation-allocation-prod.js`  
**Versión**: 1.0  
**Fecha**: 2026-01-30
