# Android (Capacitor) – App que apunta a una URL

Este proyecto es una web + backend. Con Capacitor puedes crear una app Android que **simplemente abra la URL desplegada** (sin empaquetar `public/` dentro del APK).

## 1) Requisitos

- Android Studio instalado (incluye SDK)
- JDK 17
- Node.js + npm

## 2) Configurar la URL

Edita el archivo [capacitor.config.json](capacitor.config.json) y cambia:

- `server.url`: tu dominio desplegado, por ejemplo `https://tudominio.com`
- `server.cleartext`: `false` si usas HTTPS (recomendado). Si usas HTTP, ponlo en `true`.

## 3) Comandos

- Sincronizar Android: `npm run android:sync`
- Abrir Android Studio: `npm run android:open`

## 4) Compilar

En Android Studio:

- APK: Build > Build Bundle(s) / APK(s) > Build APK(s)
- AAB (Play Store): Build > Generate Signed Bundle / APK > Android App Bundle

## Notas

- Si tu backend/API está en otro dominio distinto al de la web, puede requerir ajustes de CORS.
- Si necesitas que el WebView pueda navegar a otros hosts, añade `server.allowNavigation` en la config de Capacitor.
