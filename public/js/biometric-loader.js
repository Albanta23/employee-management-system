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

  function registerNativeBiometric() {
    try {
      const registerPlugin = (window.capacitorExports && window.capacitorExports.registerPlugin)
        ? window.capacitorExports.registerPlugin
        : (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function')
          ? window.Capacitor.registerPlugin
          : null;

      if (!registerPlugin) return false;

      // Creamos el proxy JS para el plugin nativo instalado.
      // No dependemos de CDN/bundler.
      window.NativeBiometric = registerPlugin('NativeBiometric');
      return true;
    } catch (_) {
      return false;
    }
  }

  window.__nativeBiometricReady = isNativeCapacitor()
    ? Promise.resolve(registerNativeBiometric())
    : Promise.resolve(false);
})();
