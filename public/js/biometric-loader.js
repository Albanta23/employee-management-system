// Carga dinámica del plugin biométrico SOLO en entorno nativo (Capacitor).
// En web no se carga nada para evitar errores (no existe `capacitorExports`).
(function () {
  function isNativeCapacitor() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-biometric-plugin="true"][src="${src}"]`);
      if (existing) {
        resolve(true);
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.biometricPlugin = 'true';
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('No se pudo cargar el plugin biométrico'));
      document.head.appendChild(script);
    });
  }

  // Pin de versión para evitar cambios inesperados en runtime.
  // Nota: se carga desde CDN porque el proyecto no usa bundler.
  const PLUGIN_URL = 'https://cdn.jsdelivr.net/npm/@capgo/capacitor-native-biometric@8.0.3/dist/plugin.js';

  window.__nativeBiometricReady = isNativeCapacitor()
    ? loadScript(PLUGIN_URL).catch(() => false)
    : Promise.resolve(false);
})();
