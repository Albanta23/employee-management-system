const API_URL = window.location.origin.includes('localhost')
    ? 'http://localhost:3000/api'
    : '/api';

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
    if (response.status === 401 || response.status === 403) {
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

    const response = await fetch(url, { ...defaultOptions, ...options });

    if (handleAuthError(response)) return null;

    if (response.status === 204) return true;

    const data = await response.json();
    if (!response.ok) {
        showAlert(data.error || 'Error en la petición', 'error');
        return null;
    }
    return data;
}

// API - Empleados
const employeesAPI = {
    getAll: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/employees${query ? '?' + query : ''}`);
    },
    getStats: () => callAPI(`${API_URL}/employees/stats`),
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
    getCalendar: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return callAPI(`${API_URL}/vacations/calendar?${query}`);
    },
    getById: (id) => callAPI(`${API_URL}/vacations/${id}`),
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
    }
};

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
