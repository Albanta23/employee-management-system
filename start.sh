#!/bin/bash

# Definir el puerto
PORT=3000

echo "🔍 Buscando procesos en el puerto $PORT..."

# Encontrar el proceso que usa el puerto
PID=$(lsof -t -i:$PORT)

if [ -n "$PID" ]; then
    echo "⚠️  Proceso encontrado en el puerto $PORT (PID: $PID). Matando..."
    kill -9 $PID
    echo "✅ Proceso eliminado."
else
    echo "✅ El puerto $PORT está libre."
fi

echo "🚀 Iniciando la aplicación..."
npm start
