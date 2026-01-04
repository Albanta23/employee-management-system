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

async function punch(dni, code) {
    const coords = await getDeviceLocation();
    return fetchJSON(`${API_URL}/store-clock/punch`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            dni,
            code,
            latitude: coords ? coords.latitude : undefined,
            longitude: coords ? coords.longitude : undefined
        })
    });
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

            const code = window.prompt(`Código de acceso para ${emp.full_name} (${empDni})`);
            if (code === null) return; // cancel
            if (!String(code).trim()) {
                showAlert('Código requerido', 'error');
                return;
            }

            btn.disabled = true;
            try {
                const result = await punch(empDni, code);
                if (!result) return;

                showPunchConfirmation(result);
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
    const pin = (document.getElementById('store-pin').value || '').trim();

    if (!storeName || !pin) {
        showAlert('Introduce nombre de tienda y PIN', 'error');
        return;
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
