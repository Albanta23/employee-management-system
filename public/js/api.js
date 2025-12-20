const API_URL = 'http://localhost:3000/api';

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

// API - Empleados
const employeesAPI = {
    getAll: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        const url = `${API_URL}/employees${queryString ? '?' + queryString : ''}`;

        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    getStats: async () => {
        const response = await fetch(`${API_URL}/employees/stats`, {
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    getById: async (id) => {
        const response = await fetch(`${API_URL}/employees/${id}`, {
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    create: async (data) => {
        const response = await fetch(`${API_URL}/employees`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    update: async (id, data) => {
        const response = await fetch(`${API_URL}/employees/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    delete: async (id) => {
        const response = await fetch(`${API_URL}/employees/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    }
};

// API - Vacaciones
const vacationsAPI = {
    getAll: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        const url = `${API_URL}/vacations${queryString ? '?' + queryString : ''}`;

        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    getCalendar: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        const url = `${API_URL}/vacations/calendar${queryString ? '?' + queryString : ''}`;

        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    getById: async (id) => {
        const response = await fetch(`${API_URL}/vacations/${id}`, {
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    create: async (data) => {
        const response = await fetch(`${API_URL}/vacations`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    update: async (id, data) => {
        const response = await fetch(`${API_URL}/vacations/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    delete: async (id) => {
        const response = await fetch(`${API_URL}/vacations/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    }
};

// API - Bajas
const absencesAPI = {
    getAll: async (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        const url = `${API_URL}/absences${queryString ? '?' + queryString : ''}`;

        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    create: async (data) => {
        const response = await fetch(`${API_URL}/absences`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    update: async (id, data) => {
        const response = await fetch(`${API_URL}/absences/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    },

    delete: async (id) => {
        const response = await fetch(`${API_URL}/absences/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (handleAuthError(response)) return null;
        return await response.json();
    }
};

// Utilidades
function showAlert(message, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} fade-in`;
    alert.textContent = message;

    const container = document.getElementById('alert-container') || document.querySelector('.container');
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
