function isNativeCapacitor() {
    try {
        return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (_) {
        return false;
    }
}

// En web: usamos '/api' (mismo dominio) excepto en local.
// En app nativa: el origen es 'capacitor://localhost' y '/api' NO apunta al backend.
// Permitimos override por localStorage y dejamos un fallback al dominio de producción.
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

// Obtener token del localStorage
function getToken() {
    return localStorage.getItem('token');
}

// Obtener usuario del localStorage
function getUser() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
}

// Verificar si está autenticado
function isAuthenticated() {
    return !!getToken();
}

// Cerrar sesión
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

// Headers con autenticación
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
    };
}

// Manejo de errores de autenticación
function handleAuthError(response) {
    // 401 => token inválido/expirado (cerrar sesión)
    // 403 => permisos insuficientes (no cerrar sesión: puede ser un rol limitado como coordinador)
    if (response.status === 401) {
        logout();
        return true;
    }
    return false;
}

// Generic API caller
async function callAPI(url, options = {}) {
    const defaultOptions = {
        headers: getAuthHeaders()
    };

    let response;
    try {
        response = await fetch(url, { ...defaultOptions, ...options });
    } catch (err) {
        // Error de red (servidor caído, conexión rechazada, CORS, etc.)
        const msg = err && err.message ? err.message : 'Error de red: no se pudo conectar con el servidor';
        showAlert(`No se pudo conectar con el servidor. ${msg}`, 'error');
        return null;
    }

    if (handleAuthError(response)) return null;

    if (response.status === 204) return true;

    // Algunas respuestas (404/500) pueden venir como HTML/texto (p.ej. proxy, error page).
    // Intentamos JSON primero y, si falla, mostramos un mensaje legible.
    let data = null;
    let rawText = '';
    const contentType = response.headers.get('content-type') || '';

    try {
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            rawText = await response.text();
        }
    } catch (e) {
        try {
            rawText = await response.text();
        } catch (_) {
            rawText = '';
        }
    }

    if (!response.ok) {
        const message = (data && data.error)
            ? data.error
            : rawText
                ? `Error ${response.status}: ${rawText.slice(0, 120)}`
                : `Error ${response.status} en la petición`;
        showAlert(message, 'error');
        return null;
    }

    return data ?? (rawText ? { text: rawText } : null);
}

const authAPI = {
    changePassword: async (newPassword, token) => {
        const response = await fetch(`${API_URL}/auth/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ newPassword })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Error al cambiar la contraseña');
        }
        return data;
    }
};

// API - Empleados
const employeesAPI = {
    getAll: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/employees${query ? '?' + query : ''}`);
    },
    getStats: () => callAPI(`${API_URL}/employees/stats`),
    getMe: () => callAPI(`${API_URL}/employees/me`),
    getById: (id) => callAPI(`${API_URL}/employees/${id}`),
    create: (data) => callAPI(`${API_URL}/employees`, {
        method: 'POST',
        body: JSON.stringify(data)
    }),
    update: (id, data) => callAPI(`${API_URL}/employees/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    delete: (id) => callAPI(`${API_URL}/employees/${id}`, { method: 'DELETE' })
};

// API - Vacaciones
const vacationsAPI = {
    getAll: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/vacations${query ? '?' + query : ''}`);
    },
    getBalance: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/vacations/balance${query ? '?' + query : ''}`);
    },
    getBalances: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/vacations/balances${query ? '?' + query : ''}`);
    },
    getCalendar: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/vacations/calendar?${query}`);
    },
    getTeamCalendar: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/vacations/team-calendar${query ? '?' + query : ''}`);
    },
    getById: (id) => callAPI(`${API_URL}/vacations/${id}`),
    getByEmployee: (employeeId) => {
        return callAPI(`${API_URL}/vacations?employee_id=${employeeId}`);
    },
    create: (data) => callAPI(`${API_URL}/vacations`, {
        method: 'POST',
        body: JSON.stringify(data)
    }),
    update: (id, data) => callAPI(`${API_URL}/vacations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    delete: (id) => callAPI(`${API_URL}/vacations/${id}`, { method: 'DELETE' })
};

// API - Auditoría
const auditAPI = {
    getLogs: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/audit${query ? '?' + query : ''}`);
    }
};

// API - Reportes (gestión)
const reportsAPI = {
    getVacationConsumption: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/reports/vacation-consumption${query ? '?' + query : ''}`);
    },
    getAbsencesByType: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/reports/absences-by-type${query ? '?' + query : ''}`);
    },
    getMonthlyLocationSummary: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/reports/monthly-location-summary${query ? '?' + query : ''}`);
    }
};

// API - Bajas
const absencesAPI = {
    getAll: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/absences${query ? '?' + query : ''}`);
    },
    create: (data) => callAPI(`${API_URL}/absences`, {
        method: 'POST',
        body: JSON.stringify(data)
    }),
    update: (id, data) => callAPI(`${API_URL}/absences/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    delete: (id) => callAPI(`${API_URL}/absences/${id}`, { method: 'DELETE' })
};

const holidaysAPI = {
    getAll: () => callAPI(`${API_URL}/holidays`),
    create: (data) => callAPI(`${API_URL}/holidays`, {
        method: 'POST',
        body: JSON.stringify(data)
    }),
    delete: (id) => callAPI(`${API_URL}/holidays/${id}`, { method: 'DELETE' }),
    calculate: (params) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/holidays/calculate?${query}`);
    }
};

// Control Horario API
const attendanceAPI = {
    register: (data) => callAPI(`${API_URL}/attendance/register`, {
        method: 'POST',
        body: JSON.stringify(data)
    }),
    getStatus: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/attendance/status?${query}`);
    },
    getReport: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/attendance/report?${query}`);
    },
    getCompliance: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/attendance/compliance?${query}`);
    }
};

// Configuración API
const settingsAPI = {
    get: () => callAPI(`${API_URL}/settings`),
    getAdmin: () => callAPI(`${API_URL}/settings/admin`),
    getAccess: () => callAPI(`${API_URL}/settings/access`),
    getOverlapRules: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/settings/overlap-rules${query ? '?' + query : ''}`);
    },
    getOverlapRuleTargets: () => callAPI(`${API_URL}/settings/overlap-rules/targets`),
    getVacationPolicy: () => callAPI(`${API_URL}/settings/vacation-policy`),
    update: (data) => callAPI(`${API_URL}/settings`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    updateStoreCoordinator: (data) => callAPI(`${API_URL}/settings/store-coordinator`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    updateOverlapRules: (data) => callAPI(`${API_URL}/settings/overlap-rules`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    updateVacationPolicy: (data) => callAPI(`${API_URL}/settings/vacation-policy`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    updateAdmin: (data) => callAPI(`${API_URL}/settings/admin-credentials`, {
        method: 'PUT',
        body: JSON.stringify(data)
    })
};

// Guard + menú para rol store_coordinator
(function enforceStoreCoordinatorUI() {
    async function run() {
        const user = getUser();
        if (!user || user.role !== 'store_coordinator') return;

        const accessData = await settingsAPI.getAccess();
        if (!accessData || accessData.role !== 'store_coordinator') return;

        if (!accessData.enabled) {
            showAlert('El perfil de Coordinador está desactivado', 'warning');
        }

        const access = accessData.access || {};

        // Ocultar Configuración solo si no tiene permiso
        const settingsLink = document.querySelector('.sidebar a[href="settings.html"]');
        if (settingsLink) {
            const li = settingsLink.closest('li');
            if (li) li.style.display = access.settings ? '' : 'none';
        }

        const featureToHref = {
            dashboard: 'dashboard.html',
            reports: 'reports.html',
            employees: 'employees.html',
            attendance: 'attendance-admin.html',
            vacations: 'vacations.html',
            absences: 'absences.html',
            permissions: 'permissions.html'
        };

        for (const [feature, href] of Object.entries(featureToHref)) {
            if (access[feature] === false) {
                const link = document.querySelector(`.sidebar a[href="${href}"]`);
                if (link) {
                    const li = link.closest('li');
                    if (li) li.style.display = 'none';
                }
            }
        }

        // Redirección si entra a una página no permitida
        const currentPage = (window.location.pathname.split('/').pop() || '').toLowerCase();
        const pageToFeature = {
            'dashboard.html': 'dashboard',
            'reports.html': 'reports',
            'employees.html': 'employees',
            'employee-form.html': 'employees',
            'employee-profile.html': 'employees',
            'vacations.html': 'vacations',
            'absences.html': 'absences',
            'permissions.html': 'permissions',
            'attendance-admin.html': 'attendance',
            'employee-reports.html': 'reports',
            'settings.html': 'settings'
        };

        const feature = pageToFeature[currentPage];
        if (feature === 'settings') {
            showAlert('No tienes acceso a Configuración', 'warning');
            window.location.href = 'dashboard.html';
            return;
        }

        if (feature && access[feature] === false) {
            showAlert('No tienes acceso a esta sección', 'warning');
            window.location.href = 'dashboard.html';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Fire & forget
        run().catch(() => { /* no-op */ });
    });
})();

// Utilidades
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

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function formatPhone(phone) {
    if (!phone) return '-';
    return phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}

// Marca de agua global (no interactiva)
(function ensureGlobalWatermark() {
    const WATERMARK_TEXT = 'By JCF2025DV';

    function positionWatermark(watermarkEl) {
        const bottomNav = document.querySelector('.bottom-nav');
        if (bottomNav) {
            const navHeight = bottomNav.getBoundingClientRect().height || 0;
            const extra = 12;
            watermarkEl.style.bottom = `calc(${Math.ceil(navHeight + extra)}px + env(safe-area-inset-bottom, 0px))`;
        } else {
            watermarkEl.style.bottom = 'calc(var(--spacing-lg) + env(safe-area-inset-bottom, 0px))';
        }
    }

    function addWatermark() {
        if (document.querySelector('.app-watermark')) return;

        const el = document.createElement('div');
        el.className = 'app-watermark';
        el.textContent = WATERMARK_TEXT;
        document.body.appendChild(el);

        positionWatermark(el);
        window.addEventListener('resize', () => positionWatermark(el));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addWatermark);
    } else {
        addWatermark();
    }
})();
