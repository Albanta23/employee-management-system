# Usar una imagen ligera de Node.js
FROM node:20-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias esenciales
# Usamos --omit=dev para una imagen de producción más pequeña
RUN npm install --omit=dev

# Copiar el resto del código de la aplicación
COPY . .

# Exponer el puerto que usa la aplicación
EXPOSE 3000

# Variables de entorno por defecto
ENV PORT=3000
ENV NODE_ENV=production

# Comando para arrancar la aplicación
CMD ["node", "server.js"]
