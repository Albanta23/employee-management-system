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

      // 1) Preferido: proxy creado con registerPlugin.
      if (registerPlugin) {
        // Creamos el proxy JS para el plugin nativo instalado.
        // No dependemos de CDN/bundler.
        window.NativeBiometric = registerPlugin('NativeBiometric');
        return true;
      }

      // 2) Fallback (compatibilidad): algunos runtimes exponen plugins ya montados aquí.
      const legacy = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric
        ? window.Capacitor.Plugins.NativeBiometric
        : null;

      if (legacy) {
        window.NativeBiometric = legacy;
        return true;
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  window.__nativeBiometricReady = isNativeCapacitor()
    ? Promise.resolve(registerNativeBiometric())
    : Promise.resolve(false);
})();
