// Helpers para login con huella/cara en app nativa (Capacitor).
// Mantiene el login web intacto: si no hay Capacitor o plugin, no hace nada.
(function () {
  function getAlertContainer() {
    return document.getElementById('alert-container');
  }

  function showInlineAlert(message, type) {
    const alertContainer = getAlertContainer();
    if (!alertContainer) return;
    const css = type === 'success' ? 'alert-success' : 'alert-error';
    const symbol = type === 'success' ? '✓' : '✗';
    alertContainer.innerHTML = `
      <div class="alert ${css} fade-in">
        ${symbol} ${message}
      </div>
    `;
  }

  function isNativeCapacitor() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  async function ensurePluginLoaded() {
    const p = window.__nativeBiometricReady;
    if (p && typeof p.then === 'function') {
      await p;
    }
  }

  function getNativeBiometric() {
    // Preferimos el proxy registrado localmente (sin CDN).
    if (window.NativeBiometric) return window.NativeBiometric;
    // Compatibilidad con el formato UMD antiguo.
    return window.capacitorCapacitorBiometric && window.capacitorCapacitorBiometric.NativeBiometric
      ? window.capacitorCapacitorBiometric.NativeBiometric
      : null;
  }

  function getServerKey() {
    return (window.BIOMETRIC_SERVER_KEY && String(window.BIOMETRIC_SERVER_KEY))
      || window.location.host
      || 'employee-management-system';
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b64).split('').map((c) => `%${('00' + c.charCodeAt(0).toString(16)).slice(-2)}`).join(''));
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  async function canUseBiometrics() {
    if (!isNativeCapacitor()) return false;
    await ensurePluginLoaded();
    const NativeBiometric = getNativeBiometric();
    if (!NativeBiometric) return false;

    try {
      const result = await NativeBiometric.isAvailable();
      return !!(result && result.isAvailable);
    } catch (_) {
      return false;
    }
  }

  async function isBiometricLoginConfigured() {
    await ensurePluginLoaded();
    const NativeBiometric = getNativeBiometric();
    if (!NativeBiometric) return false;

    try {
      const result = await NativeBiometric.isCredentialsSaved({ server: getServerKey() });
      return !!(result && result.isSaved);
    } catch (_) {
      return false;
    }
  }

  async function saveCredentials(token, user) {
    await ensurePluginLoaded();
    const NativeBiometric = getNativeBiometric();
    if (!NativeBiometric) throw new Error('Biometría no disponible');

    // Guardamos token + user en el almacén seguro del dispositivo.
    // Nota: el plugin usa campos `username`/`password`; aquí los reutilizamos como strings.
    await NativeBiometric.setCredentials({
      server: getServerKey(),
      username: String(token || ''),
      password: JSON.stringify(user || {})
    });
  }

  async function biometricLogin() {
    await ensurePluginLoaded();
    const NativeBiometric = getNativeBiometric();
    if (!NativeBiometric) throw new Error('Biometría no disponible');

    await NativeBiometric.verifyIdentity({
      reason: 'Para iniciar sesión',
      title: 'Iniciar sesión',
    });

    const credentials = await NativeBiometric.getCredentials({ server: getServerKey() });
    const token = credentials && credentials.username ? String(credentials.username) : '';

    let user = null;
    try {
      user = credentials && credentials.password ? JSON.parse(String(credentials.password)) : null;
    } catch (_) {
      user = null;
    }

    if (!token) throw new Error('No hay sesión guardada para biometría');

    if (!user || typeof user !== 'object') {
      const payload = decodeJwtPayload(token) || {};
      user = {
        id: payload.id,
        username: payload.username,
        role: payload.role || 'admin',
        employee_id: payload.employee_id
      };
    }

    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    return user;
  }

  async function initLoginPage() {
    const optInContainer = document.getElementById('biometricOptInContainer');
    const biometricBtn = document.getElementById('biometricLoginBtn');

    // Por defecto: no mostrar nada adicional.
    if (optInContainer) optInContainer.style.display = 'none';
    if (biometricBtn) biometricBtn.style.display = 'none';

    const available = await canUseBiometrics();
    if (!available) return;

    if (optInContainer) optInContainer.style.display = '';

    const configured = await isBiometricLoginConfigured();
    if (configured && biometricBtn) {
      biometricBtn.style.display = '';
      biometricBtn.addEventListener('click', async () => {
        try {
          const user = await biometricLogin();
          showInlineAlert('Inicio de sesión con biometría exitoso. Redirigiendo...', 'success');
          setTimeout(() => {
            if (user && user.role === 'employee') {
              window.location.href = 'employee-dashboard.html';
            } else {
              window.location.href = 'dashboard.html';
            }
          }, 500);
        } catch (e) {
          const msg = e && e.message ? e.message : 'No se pudo iniciar sesión con biometría';
          showInlineAlert(msg, 'error');
        }
      });
    }
  }

  window.BiometricAuth = {
    isNativeCapacitor,
    canUseBiometrics,
    isBiometricLoginConfigured,
    saveCredentials,
    biometricLogin,
    initLoginPage
  };
})();
