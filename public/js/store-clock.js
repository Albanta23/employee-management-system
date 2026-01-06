function showAlert(message, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} fade-in`;
    alert.textContent = message;

    const container = document.getElementById('alert-container') || document.body;
    if (container) {
        container.insertBefore(alert, container.firstChild);

        setTimeout(() => {
            alert.style.opacity = '0';
            setTimeout(() => alert.remove(), 300);
        }, 5000);
    }
}

let codeModalEls = null;
let codeModalResolver = null;

function initCodeModal() {
    if (codeModalEls) return codeModalEls;

    const modal = document.getElementById('code-modal');
    const title = document.getElementById('code-modal-title');
    const subtitle = document.getElementById('code-modal-subtitle');
    const input = document.getElementById('code-input');
    const toggle = document.getElementById('code-toggle-visibility');
    const accept = document.getElementById('code-accept');
    const cancel = document.getElementById('code-cancel');
    const close = document.getElementById('code-modal-close');

    if (!modal || !title || !subtitle || !input || !toggle || !accept || !cancel || !close) {
        return null;
    }

    function setMasked(masked) {
        input.type = masked ? 'password' : 'text';
        toggle.textContent = masked ? 'Mostrar' : 'Ocultar';
        toggle.setAttribute('aria-pressed', masked ? 'false' : 'true');
    }

    function updateAcceptEnabled() {
        const v = String(input.value || '').trim();
        accept.disabled = !v;
    }

    function closeWith(result) {
        if (!modal.classList.contains('active')) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        setMasked(true);

        const resolve = codeModalResolver;
        codeModalResolver = null;
        if (typeof resolve === 'function') resolve(result);
    }

    // Cerrar al pulsar fuera del contenido
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeWith(null);
    });

    // Cerrar con Escape / confirmar con Enter
    document.addEventListener('keydown', (e) => {
        if (!modal.classList.contains('active')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeWith(null);
            return;
        }
        if (e.key === 'Enter') {
            const v = String(input.value || '').trim();
            if (!v) return;
            e.preventDefault();
            closeWith(v);
        }
    });

    toggle.addEventListener('click', () => {
        const masked = input.type !== 'text';
        setMasked(!masked);
        input.focus();
    });

    input.addEventListener('input', () => {
        // Mantener sólo dígitos (sin bloquear pegado, simplemente limpiamos)
        const raw = String(input.value || '');
        const digits = raw.replace(/\D+/g, '');
        if (raw !== digits) input.value = digits;
        updateAcceptEnabled();
    });

    accept.addEventListener('click', () => {
        const v = String(input.value || '').trim();
        if (!v) return;
        closeWith(v);
    });

    cancel.addEventListener('click', () => closeWith(null));
    close.addEventListener('click', () => closeWith(null));

    // Teclado numérico (delegación)
    modal.querySelector('.code-keypad')?.addEventListener('click', (e) => {
        const target = e.target;
        if (!target || target.tagName !== 'BUTTON') return;

        const key = target.getAttribute('data-key');
        const action = target.getAttribute('data-action');

        if (key) {
            input.value = `${String(input.value || '')}${key}`;
            updateAcceptEnabled();
            input.focus();
            return;
        }

        if (action === 'backspace') {
            input.value = String(input.value || '').slice(0, -1);
            updateAcceptEnabled();
            input.focus();
            return;
        }

        if (action === 'clear') {
            input.value = '';
            updateAcceptEnabled();
            input.focus();
        }
    });

    codeModalEls = {
        modal,
        title,
        subtitle,
        input,
        toggle,
        accept,
        setMasked,
        updateAcceptEnabled,
        closeWith
    };

    return codeModalEls;
}

function promptCodeModal({ title, subtitle }) {
    const els = initCodeModal();
    if (!els) {
        // Fallback (no debería ocurrir)
        // eslint-disable-next-line no-alert
        const v = window.prompt(title || 'Introduce el código');
        return Promise.resolve(v === null ? null : String(v || '').trim());
    }

    els.title.textContent = String(title || 'Introduce tu código');
    els.subtitle.textContent = String(subtitle || '');
    els.input.value = '';
    els.setMasked(true);
    els.updateAcceptEnabled();

    els.modal.classList.add('active');
    els.modal.setAttribute('aria-hidden', 'false');

    // Si había un prompt anterior colgado, cancelarlo
    if (typeof codeModalResolver === 'function') {
        try { codeModalResolver(null); } catch (_) { /* no-op */ }
    }

    return new Promise((resolve) => {
        codeModalResolver = resolve;
        setTimeout(() => {
            try { els.input.focus(); } catch (_) { /* no-op */ }
        }, 0);
    });
}

async function promptStorePinIntoInput() {
    const pinInput = document.getElementById('store-pin');
    if (!pinInput) return;

    const storeName = (document.getElementById('store-name')?.value || '').trim();
    const subtitle = storeName ? `Tienda: ${storeName}` : 'Introduce el PIN de tienda';

    const pin = await promptCodeModal({
        title: 'PIN de tienda',
        subtitle
    });

    if (pin === null) return; // cancel
    pinInput.value = String(pin || '').trim();
}

function isNativeCapacitor() {
    try {
        return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (_) {
        return false;
    }
}

const API_URL = (() => {
    const override = localStorage.getItem('API_URL_OVERRIDE');
    if (override && String(override).trim()) return String(override).trim();

    if (isNativeCapacitor()) {
        return 'https://employee-management-system-xi-swart.vercel.app/api';
    }

    return window.location.origin.includes('localhost')
        ? 'http://localhost:3000/api'
        : '/api';
})();

const STORAGE_KEY = 'storeClockToken';
const STORE_NAME_KEY = 'storeClockStoreName';
const LAST_STORE_NAME_KEY = 'storeClockLastStoreName';

function getUrlStoreName() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const raw = params.get('store');
        return raw ? String(raw).trim() : '';
    } catch (_) {
        return '';
    }
}

function setUrlStoreName(storeName) {
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('store', String(storeName || '').trim());
        window.history.replaceState({}, '', url.toString());
    } catch (_) {
        // no-op
    }
}

function setSession(token, storeName) {
    sessionStorage.setItem(STORAGE_KEY, token);
    sessionStorage.setItem(STORE_NAME_KEY, storeName);
    if (storeName) localStorage.setItem(LAST_STORE_NAME_KEY, String(storeName));
}

function clearSession() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORE_NAME_KEY);
}

function getStoreToken() {
    return sessionStorage.getItem(STORAGE_KEY);
}

function getUnifiedToken() {
    return localStorage.getItem('token');
}

function getUnifiedUser() {
    try {
        const raw = localStorage.getItem('user');
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function getStoreName() {
    return sessionStorage.getItem(STORE_NAME_KEY);
}

function getUnifiedStoreName() {
    const u = getUnifiedUser();
    if (!u || u.role !== 'store_clock') return '';
    return String(u.storeName || u.username || '').trim();
}

function setupStoreNameInput() {
    const input = document.getElementById('store-name');
    if (!input) return;

    const urlStore = getUrlStoreName();
    const lastStore = (localStorage.getItem(LAST_STORE_NAME_KEY) || '').trim();

    if (urlStore) {
        input.value = urlStore;
        input.disabled = true;
        return;
    }

    if (lastStore && !input.value) {
        input.value = lastStore;
    }
}

async function fetchJSON(url, options = {}) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (err) {
        const msg = err && err.message ? err.message : 'Error de red';
        showAlert(`No se pudo conectar con el servidor. ${msg}`, 'error');
        return null;
    }

    if (response.status === 204) return true;

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    try {
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const t = await response.text();
            data = t ? { text: t } : null;
        }
    } catch (_) {
        data = null;
    }

    if (!response.ok) {
        const msg = (data && data.error) ? data.error : `Error ${response.status}`;
        showAlert(msg, 'error');
        return null;
    }

    return data;
}

async function fetchJSONDetailed(url, options = {}, { showErrors = true } = {}) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (err) {
        const msg = err && err.message ? err.message : 'Error de red';
        if (showErrors) showAlert(`No se pudo conectar con el servidor. ${msg}`, 'error');
        return { ok: false, status: 0, data: { error: msg } };
    }

    if (response.status === 204) return { ok: true, status: 204, data: true };

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    try {
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const t = await response.text();
            data = t ? { text: t } : null;
        }
    } catch (_) {
        data = null;
    }

    if (!response.ok) {
        const msg = (data && data.error) ? data.error : `Error ${response.status}`;
        if (showErrors) showAlert(msg, 'error');
        return { ok: false, status: response.status, data: data || { error: msg } };
    }

    return { ok: true, status: response.status, data };
}

function getAuthHeaders() {
    const token = getStoreToken() || getUnifiedToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
}

async function storeLogin(storeName, pin) {
    return fetchJSON(`${API_URL}/store-clock/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeName, pin })
    });
}

async function loadEmployees() {
    return fetchJSON(`${API_URL}/store-clock/employees`, {
        method: 'GET',
        headers: getAuthHeaders()
    });
}

async function punch(dni, code, { showErrors = true } = {}) {
    const coords = await getDeviceLocation();
    return fetchJSONDetailed(
        `${API_URL}/store-clock/punch`,
        {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            dni,
            code,
            latitude: coords ? coords.latitude : undefined,
            longitude: coords ? coords.longitude : undefined
        })
        },
        { showErrors }
    );
}

async function loginForCodeChange(username, password) {
    return fetchJSONDetailed(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
}

async function changePasswordWithToken(newPassword, changeToken) {
    return fetchJSONDetailed(`${API_URL}/auth/change-password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(changeToken ? { 'Authorization': `Bearer ${changeToken}` } : {})
        },
        body: JSON.stringify({ newPassword })
    });
}

function isMustChangeError(payload) {
    const msg = payload && (payload.error || payload.text) ? String(payload.error || payload.text) : '';
    return /debe\s+cambiar|cambiar\s+su\s+c[oó]digo|cambiar\s+tu\s+c[oó]digo|cambiar\s+la\s+contrase/i.test(msg);
}

function getErrorMessage(payload, fallback = 'Error') {
    if (!payload) return fallback;
    if (payload.error) return String(payload.error);
    if (payload.text) return String(payload.text);
    return fallback;
}

async function handleMustChangeFlow(dni, currentCode) {
    // 1) Obtener changeToken como en la app (login normal)
    const loginResp = await loginForCodeChange(dni, currentCode);
    if (!loginResp.ok) return null;

    const loginData = loginResp.data || {};
    const changeToken = loginData.changeToken;
    const forceChange = !!loginData.forceChange;
    if (!forceChange || !changeToken) {
        showAlert('No se pudo iniciar el cambio de código. Contacta con administración.', 'error');
        return null;
    }

    // 2) Pedir nuevo código
    const newCode1 = await promptCodeModal({
        title: 'Debes cambiar tu código de acceso',
        subtitle: 'Introduce el nuevo código'
    });
    if (newCode1 === null) return null;

    const newCode2 = await promptCodeModal({
        title: 'Debes cambiar tu código de acceso',
        subtitle: 'Repite el nuevo código'
    });
    if (newCode2 === null) return null;

    const a = String(newCode1 || '').trim();
    const b = String(newCode2 || '').trim();

    if (!a || !b) {
        showAlert('Código nuevo requerido', 'error');
        return null;
    }
    if (a !== b) {
        showAlert('Los códigos no coinciden', 'error');
        return null;
    }

    // 3) Cambiar contraseña/código
    const changeResp = await changePasswordWithToken(a, changeToken);
    if (!changeResp.ok) return null;

    showAlert('Código actualizado. Ya puedes fichar.', 'success');
    return a;
}

function getDeviceLocation() {
    return new Promise((resolve) => {
        try {
            if (!navigator.geolocation) return resolve(null);

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const latitude = pos && pos.coords ? Number(pos.coords.latitude) : null;
                    const longitude = pos && pos.coords ? Number(pos.coords.longitude) : null;
                    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return resolve(null);
                    resolve({ latitude, longitude });
                },
                () => resolve(null),
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
            );
        } catch (_) {
            resolve(null);
        }
    });
}

function setUIConnected(connected) {
    const loginSection = document.getElementById('login-section');
    const employeesSection = document.getElementById('employees-section');
    const storeLabel = document.getElementById('store-label');

    if (connected) {
        const sname = getStoreName() || getUnifiedStoreName();
        storeLabel.textContent = sname ? `Tienda: ${sname}` : 'Conectado';
        loginSection.classList.add('hidden');
        employeesSection.classList.remove('hidden');
    } else {
        storeLabel.textContent = 'No conectado';
        employeesSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
    }
}

function renderEmployees(employees) {
    const grid = document.getElementById('employees-grid');
    grid.innerHTML = '';

    if (!employees || employees.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'No hay empleados activos asignados a esta tienda.';
        grid.appendChild(empty);
        return;
    }

    for (const emp of employees) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary employee-btn';
        btn.type = 'button';

        const name = document.createElement('span');
        name.className = 'employee-name';
        name.textContent = emp.full_name || 'Empleado';

        const dni = document.createElement('span');
        dni.className = 'employee-dni';
        dni.textContent = emp.dni || '';

        btn.appendChild(name);
        btn.appendChild(dni);

        btn.addEventListener('click', async () => {
            const empDni = String(emp.dni || '').trim();
            if (!empDni) {
                showAlert('Empleado inválido', 'error');
                return;
            }

            const code = await promptCodeModal({
                title: 'Código de acceso',
                subtitle: `${emp.full_name || 'Empleado'} (${empDni})`
            });
            if (code === null) return; // cancel
            if (!String(code).trim()) {
                showAlert('Código requerido', 'error');
                return;
            }

            btn.disabled = true;
            try {
                const attempt = await punch(empDni, code, { showErrors: false });
                if (attempt && attempt.ok) {
                    showPunchConfirmation(attempt.data);
                    return;
                }

                // Si debe cambiar el código, reutilizamos el flujo existente (/auth/login + /auth/change-password)
                if (attempt && attempt.status === 403 && isMustChangeError(attempt.data)) {
                    const updatedCode = await handleMustChangeFlow(empDni, String(code).trim());
                    if (!updatedCode) return;

                    const retry = await punch(empDni, updatedCode, { showErrors: false });
                    if (retry && retry.ok) {
                        showPunchConfirmation(retry.data);
                        return;
                    }

                    showAlert(getErrorMessage(retry ? retry.data : null, 'No se pudo fichar'), 'error');
                    return;
                }

                showAlert(getErrorMessage(attempt ? attempt.data : null, 'No se pudo fichar'), 'error');
            } finally {
                btn.disabled = false;
            }
        });

        grid.appendChild(btn);
    }
}

let punchModalTimer = null;

function formatPunchType(type) {
    if (type === 'in') return 'ENTRADA';
    if (type === 'out') return 'SALIDA';
    if (type === 'break_start') return 'INICIO DESCANSO';
    if (type === 'break_end') return 'FIN DESCANSO';
    return String(type || '').toUpperCase() || '-';
}

function badgeClassForType(type) {
    if (type === 'in') return 'badge-success';
    if (type === 'out') return 'badge-danger';
    return 'badge-warning';
}

function showPunchConfirmation(result) {
    const modal = document.getElementById('punch-modal');
    const employeeEl = document.getElementById('punch-employee');
    const typeEl = document.getElementById('punch-type');
    const datetimeEl = document.getElementById('punch-datetime');

    if (!modal || !employeeEl || !typeEl || !datetimeEl) {
        // Fallback
        const label = result && result.type === 'in' ? 'ENTRADA' : 'SALIDA';
        showAlert(`✅ Fichaje de ${label} registrado`, 'success');
        return;
    }

    const emp = result && result.employee ? result.employee : null;
    const name = emp && emp.full_name ? String(emp.full_name) : 'Empleado';
    const dni = emp && emp.dni ? String(emp.dni) : '';
    employeeEl.textContent = dni ? `${name} (${dni})` : name;

    const punchType = result && result.type ? String(result.type) : '';
    typeEl.textContent = formatPunchType(punchType);
    typeEl.className = `badge ${badgeClassForType(punchType)}`;

    const ts = result && result.timestamp ? new Date(result.timestamp) : new Date();
    datetimeEl.textContent = ts.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    modal.classList.add('active');
    if (punchModalTimer) clearTimeout(punchModalTimer);
    punchModalTimer = setTimeout(() => {
        modal.classList.remove('active');
    }, 5000);
}

async function refreshEmployees() {
    const data = await loadEmployees();
    if (!data) {
        // token inválido o error; volvemos a login
        clearSession();
        setUIConnected(false);
        return;
    }

    renderEmployees(data.employees || []);
}

async function onLoginClick() {
    const storeName = (document.getElementById('store-name').value || '').trim();
    let pin = (document.getElementById('store-pin').value || '').trim();

    if (!storeName) {
        showAlert('Introduce nombre de tienda y PIN', 'error');
        return;
    }

    if (!pin) {
        await promptStorePinIntoInput();
        pin = (document.getElementById('store-pin').value || '').trim();
        if (!pin) {
            showAlert('Introduce nombre de tienda y PIN', 'error');
            return;
        }
    }

    const data = await storeLogin(storeName, pin);
    if (!data || !data.token) return;

    const resolvedStore = (data.storeName || storeName).trim();
    setSession(data.token, resolvedStore);
    if (resolvedStore) setUrlStoreName(resolvedStore);
    setUIConnected(true);
    await refreshEmployees();
}

function onLogoutClick() {
    clearSession();
    setUIConnected(false);
}

document.addEventListener('DOMContentLoaded', async () => {
    setupStoreNameInput();

    document.getElementById('btn-login')?.addEventListener('click', onLoginClick);
    document.getElementById('btn-logout')?.addEventListener('click', onLogoutClick);

    // Enter para login
    document.getElementById('store-pin')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onLoginClick();
    });

    // En móvil/tablet: usar modal numérico para el PIN de tienda
    // (sin impedir que el usuario pueda teclear si lo prefiere)
    const storePinInput = document.getElementById('store-pin');
    if (storePinInput) {
        let opening = false;
        storePinInput.addEventListener('click', async () => {
            if (opening) return;
            opening = true;
            try {
                await promptStorePinIntoInput();
            } finally {
                opening = false;
            }
        });

        storePinInput.addEventListener('focus', async () => {
            // Evitar que el focus por tab/teclado abra el modal en escritorio
            // pero en pantallas táctiles suele venir de tap; click ya lo cubre.
        });
    }

    // Si la URL fuerza una tienda distinta a la sesión, invalidar sesión
    const urlStore = getUrlStoreName();
    const sessionStore = (getStoreName() || getUnifiedStoreName() || '').trim();
    if (urlStore && sessionStore && urlStore.toLowerCase() !== sessionStore.toLowerCase()) {
        clearSession();
    }

    if (getStoreToken() || (getUnifiedToken() && getUnifiedStoreName())) {
        setUIConnected(true);
        await refreshEmployees();
    } else {
        setUIConnected(false);
    }
});
