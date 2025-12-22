// Estado de la aplicación (locations module)
let currentView = 'locations';
let currentLocationId = null;
let currentStoreId = null;
let currentYear = new Date().getFullYear();
let currentUser = null;

let currentStoreEmployees = null; // [{...Employee}]
let currentStoreEmployeesStoreName = null;

let locations = [];
let currentCalendar = null; // { year, locationName, storeName, holidays: [] }
let currentLocation = null; // ubicación cargada en vista tiendas

// Meses en español
const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Wrapper compatible con el proyecto.
// Permite llamar con rutas '/api/...' y se apoya en callAPI() de public/js/api.js
async function apiRequest(urlOrPath, method = 'GET', data) {
    let url = urlOrPath;
    if (typeof url === 'string' && url.startsWith('/api/')) {
        url = `${API_URL}${url.slice(4)}`;
    }

    const upperMethod = String(method || 'GET').toUpperCase();
    const options = {};
    if (upperMethod !== 'GET') {
        options.method = upperMethod;
    }
    if (data !== undefined && upperMethod !== 'GET') {
        options.body = JSON.stringify(data);
    }

    return callAPI(url, options);
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', async () => {
    currentUser = getUser();

    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    const usernameEl = document.getElementById('navbar-username');
    if (usernameEl) {
        usernameEl.textContent = currentUser.name || currentUser.username;
    }

    if (typeof loadBranding === 'function') {
        await loadBranding();
    }

    if (currentUser.role !== 'admin' && currentUser.role !== 'store_coordinator') {
        alert('No tienes permisos para acceder a esta sección');
        window.location.href = 'employee-dashboard.html';
        return;
    }

    setupYearSelector();
    setupEventListeners();

    await loadLocations();
});

function setupEventListeners() {
    document.getElementById('btn-add-location')?.addEventListener('click', () => openLocationModal());
    document.getElementById('btn-add-store')?.addEventListener('click', () => openStoreModal());
    document.getElementById('btn-add-holiday')?.addEventListener('click', () => openHolidayModal());

    document.getElementById('location-form')?.addEventListener('submit', handleLocationSubmit);
    document.getElementById('store-form')?.addEventListener('submit', handleStoreSubmit);
    document.getElementById('holiday-form')?.addEventListener('submit', handleHolidaySubmit);

    document.getElementById('year-selector')?.addEventListener('change', (e) => {
        currentYear = parseInt(e.target.value, 10);
        loadCalendar();
    });

    // Cerrar modales al clickar fuera
    window.addEventListener('click', (event) => {
        if (event.target && event.target.classList && event.target.classList.contains('modal')) {
            event.target.classList.remove('active');
        }
    });
}

function setupYearSelector() {
    const selector = document.getElementById('year-selector');
    if (!selector) return;

    selector.innerHTML = '';
    const thisYear = new Date().getFullYear();
    for (let year = thisYear - 2; year <= thisYear + 5; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = String(year);
        if (year === thisYear) option.selected = true;
        selector.appendChild(option);
    }
}

// ==================== DATA LOAD ====================

async function loadLocations() {
    try {
        showLoading('Cargando ubicaciones...');
        const data = await apiRequest('/api/locations');
        if (!data) {
            hideLoading();
            return;
        }

        locations = data;
        renderLocations();

        if (currentUser.role === 'admin') {
            const btn = document.getElementById('btn-add-location');
            if (btn) btn.style.display = 'block';
        }

        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando ubicaciones:', error);
        showError('Error al cargar ubicaciones: ' + (error?.message || 'Error desconocido'));
    }
}

async function loadStores(locationId) {
    try {
        showLoading('Cargando tiendas...');
        const location = await apiRequest(`/api/locations/${locationId}`);
        if (!location) {
            hideLoading();
            return;
        }

        currentLocationId = locationId;
        currentLocation = location;
        // Mantener cache local actualizado para que edición/borrado funcione
        locations = (locations || []).map(l => (l._id === locationId ? location : l));
        renderStores(location);

        if (currentUser.role === 'admin') {
            const btn = document.getElementById('btn-add-store');
            if (btn) btn.style.display = 'block';
        }

        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando tiendas:', error);
        showError('Error al cargar tiendas: ' + (error?.message || 'Error desconocido'));
    }
}

async function loadCalendar() {
    if (!currentLocationId || !currentStoreId) return;

    try {
        showLoading('Cargando calendario...');
        const data = await apiRequest(
            `/api/locations/${currentLocationId}/stores/${currentStoreId}/calendar/${currentYear}`
        );
        if (!data) {
            hideLoading();
            return;
        }

        currentCalendar = data;
        renderCalendar(data);
        // Cargar empleados de la tienda en paralelo (no depende del año)
        void loadStoreEmployeesForCurrentStore();
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando calendario:', error);
        showError('Error al cargar calendario: ' + (error?.message || 'Error desconocido'));
    }
}

async function loadStoreEmployeesForCurrentStore() {
    const storeName = currentCalendar?.storeName;
    const locationName = currentCalendar?.locationName;
    const titleEl = document.getElementById('store-employees-title');
    const container = document.getElementById('store-employees-container');
    if (!container) return;

    if (titleEl) {
        titleEl.textContent = storeName ? `👥 Empleados de ${storeName}` : '👥 Empleados';
    }

    if (!storeName) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Selecciona una tienda para ver empleados</div></div>';
        return;
    }

    // Si ya tenemos la lista para esta tienda, re-renderizamos sin pedir al servidor.
    if (currentStoreEmployeesStoreName === storeName && Array.isArray(currentStoreEmployees)) {
        renderStoreEmployees(currentStoreEmployees, { storeName, locationName });
        return;
    }

    container.innerHTML = '<div style="color: var(--text-muted); padding: 0.75rem;">Cargando empleados...</div>';

    try {
        // Importante: en el sistema, Employee.location es un string (normalmente el nombre de la tienda).
        const res = await employeesAPI.getAll({
            location: storeName,
            status: 'active',
            page: 1,
            limit: 200
        });

        const employees = res && Array.isArray(res.employees) ? res.employees : (Array.isArray(res) ? res : []);
        currentStoreEmployees = employees;
        currentStoreEmployeesStoreName = storeName;

        renderStoreEmployees(employees, { storeName, locationName, total: res?.pagination?.total });
    } catch (e) {
        console.error('Error cargando empleados por tienda:', e);
        container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No se pudieron cargar los empleados</div></div>';
    }
}

function renderStoreEmployees(employees, { storeName, locationName, total } = {}) {
    const container = document.getElementById('store-employees-container');
    if (!container) return;

    if (!Array.isArray(employees) || employees.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div class="empty-state-text">No hay empleados asignados a ${escapeHtml(storeName || 'esta tienda')}</div>
                <div style="color: var(--text-muted); font-size: 0.9rem;">Revisa el campo “Ubicación” del empleado (debe coincidir con el nombre de la tienda).</div>
            </div>
        `;
        return;
    }

    const note = (Number.isFinite(Number(total)) && total > employees.length)
        ? `<div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 0.85rem;">Mostrando ${employees.length} de ${total}</div>`
        : '';

    container.innerHTML = employees.map(e => {
        const name = escapeHtml(e.full_name || e.name || 'Empleado');
        const dni = escapeHtml(e.dni || '-');
        const position = escapeHtml(e.position || '-');
        const loc = escapeHtml(e.location || locationName || '-');

        return `
            <div class="store-card" style="cursor: default;">
                <div class="store-card-title">👤 ${name}</div>
                <div class="store-card-address">🪪 ${dni}</div>
                <div class="store-card-address">💼 ${position}</div>
                <div class="store-card-address">📍 ${loc}</div>
            </div>
        `;
    }).join('') + note;
}

// ==================== RENDER ====================

function renderLocations() {
    const container = document.getElementById('locations-container');
    if (!container) return;

    if (!locations || locations.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📍</div>
                <div class="empty-state-text">No hay ubicaciones disponibles</div>
                ${currentUser.role === 'admin'
                    ? '<button class="btn btn-primary" onclick="openLocationModal()">➕ Crear Primera Ubicación</button>'
                    : ''}
            </div>
        `;
        return;
    }

    container.innerHTML = locations.map(location => {
        const storeCount = Array.isArray(location.stores) ? location.stores.length : 0;
        return `
            <div class="location-card" onclick="showStoresView('${location._id}')">
                <div class="location-card-header">
                    <h3 class="location-card-title">📍 ${escapeHtml(location.name)}</h3>
                    ${currentUser.role === 'admin' ? `
                        <button class="btn btn-secondary btn-icon" onclick="event.stopPropagation(); editLocation('${location._id}')" title="Editar">✏️</button>
                        <button class="btn btn-secondary btn-icon" onclick="event.stopPropagation(); deleteLocation('${location._id}')" title="Eliminar">🗑️</button>
                    ` : ''}
                </div>
                ${location.description ? `<div class="location-card-description">${escapeHtml(location.description)}</div>` : ''}
                <div class="location-card-stats">
                    <div class="location-card-stat"><span>🏪</span><span>${storeCount} ${storeCount === 1 ? 'tienda' : 'tiendas'}</span></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderStores(location) {
    const container = document.getElementById('stores-container');
    const title = document.getElementById('stores-view-title');
    const breadcrumb = document.getElementById('breadcrumb-location-name');
    if (!container || !title || !breadcrumb) return;

    title.textContent = `🏪 Tiendas en ${location.name}`;
    breadcrumb.textContent = location.name;

    if (!Array.isArray(location.stores) || location.stores.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🏪</div>
                <div class="empty-state-text">No hay tiendas en esta ubicación</div>
                ${currentUser.role === 'admin'
                    ? '<button class="btn btn-primary" onclick="openStoreModal()">➕ Añadir Primera Tienda</button>'
                    : ''}
            </div>
        `;
        return;
    }

    container.innerHTML = location.stores.map(store => `
        <div class="store-card" onclick="showCalendarView('${location._id}', '${store._id}')">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div style="flex:1;">
                    <div class="store-card-title">🏪 ${escapeHtml(store.name)}</div>
                    ${store.address ? `<div class="store-card-address">📍 ${escapeHtml(store.address)}</div>` : ''}
                    <div style="margin-top:0.5rem; font-size:0.85rem; color: var(--text-secondary);">
                        ${(store.localHolidays ? store.localHolidays.length : 0)} festivos locales
                    </div>
                </div>
                ${currentUser.role === 'admin' ? `
                    <div style="display:flex; gap:0.25rem;">
                        <button class="btn btn-secondary btn-icon" onclick="event.stopPropagation(); editStore('${location._id}', '${store._id}')" title="Editar">✏️</button>
                        <button class="btn btn-secondary btn-icon" onclick="event.stopPropagation(); deleteStore('${store._id}')" title="Eliminar">🗑️</button>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function renderCalendar(data) {
    const title = document.getElementById('calendar-store-title');
    const breadcrumbLocation = document.getElementById('breadcrumb-location-link');
    const breadcrumbStore = document.getElementById('breadcrumb-store-name');
    const container = document.getElementById('calendar-grid');
    const btnAddHoliday = document.getElementById('btn-add-holiday');
    if (!title || !breadcrumbLocation || !breadcrumbStore || !container) return;

    title.textContent = `📅 ${data.storeName} - ${data.year}`;
    breadcrumbLocation.textContent = data.locationName;
    breadcrumbStore.textContent = data.storeName;

    // Mostrar el botón de añadir festivo solo si puede editar
    if (btnAddHoliday) {
        btnAddHoliday.style.display = (currentUser.role === 'admin' || currentUser.role === 'store_coordinator')
            ? 'inline-flex'
            : 'none';
    }

    const holidays = Array.isArray(data.holidays) ? data.holidays : [];
    const holidaysByDay = new Map();
    for (const h of holidays) {
        const d = new Date(h.date);
        if (Number.isNaN(d.getTime())) continue;
        const key = toISODate(d);
        if (!holidaysByDay.has(key)) holidaysByDay.set(key, []);
        holidaysByDay.get(key).push(h);
    }

    // Orden estable dentro de cada día
    for (const [key, list] of holidaysByDay.entries()) {
        list.sort((a, b) => {
            const ta = new Date(a.date).getTime();
            const tb = new Date(b.date).getTime();
            if (ta !== tb) return ta - tb;
            return String(a.name || '').localeCompare(String(b.name || ''), 'es');
        });
        holidaysByDay.set(key, list);
    }

    container.innerHTML = MONTHS.map((monthName, monthIndex) => {
        const year = Number(data.year);
        const daysInMonth = getDaysInMonth(year, monthIndex);
        const firstDay = new Date(year, monthIndex, 1);
        const startOffset = getMondayFirstOffset(firstDay); // 0..6

        const cells = [];
        // Días semana (L a D)
        const dows = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
            .map(label => `<div class="dow">${label}</div>`)
            .join('');

        for (let i = 0; i < startOffset; i++) {
            cells.push('<div class="day-cell empty"></div>');
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const cellDate = new Date(year, monthIndex, day);
            const iso = toISODate(cellDate);
            const dayHolidays = holidaysByDay.get(iso) || [];

            const holidayHtml = dayHolidays.length
                ? `<div class="day-holidays">${dayHolidays.map(renderHolidayChip).join('')}</div>`
                : '';

            cells.push(`
                <div class="day-cell">
                    <div class="day-number">${day}</div>
                    ${holidayHtml}
                </div>
            `);
        }

        return `
            <div class="month-section">
                <div class="month-title">${monthName}</div>
                <div class="month-grid">
                    ${dows}
                    ${cells.join('')}
                </div>
            </div>
        `;
    }).join('');
}

function renderHolidayChip(holiday) {
    const isLocal = holiday.type === 'local';
    const canEdit = isLocal && (currentUser.role === 'admin' || currentUser.role === 'store_coordinator');
    const safeName = escapeHtml(holiday.name || 'Festivo');

    if (!canEdit) {
        return `
            <div class="holiday-chip ${holiday.type}" title="${safeName}">
                <span class="holiday-chip-name">${safeName}</span>
            </div>
        `;
    }

    return `
        <div class="holiday-chip ${holiday.type}" title="${safeName}">
            <span class="holiday-chip-name">${safeName}</span>
            <span class="holiday-chip-actions">
                <button type="button" onclick="editHoliday('${holiday._id}')" title="Editar">✏️</button>
                <button type="button" onclick="deleteHoliday('${holiday._id}')" title="Eliminar">🗑️</button>
            </span>
        </div>
    `;
}

function toISODate(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

// Convierte getDay() (0=Domingo) a offset lunes-primero (0=Lunes..6=Domingo)
function getMondayFirstOffset(date) {
    const js = new Date(date).getDay();
    return (js + 6) % 7;
}

function renderHolidayItem(holiday) {
    const date = new Date(holiday.date);
    const dateStr = `${date.getDate()}/${date.getMonth() + 1}`;
    const isLocal = holiday.type === 'local';
    const isEditable = isLocal && (currentUser.role === 'admin' || currentUser.role === 'store_coordinator');

    return `
        <div class="holiday-item ${holiday.type}">
            <span class="holiday-date">${dateStr}</span>
            <span class="holiday-name" title="${escapeHtml(holiday.name)}">${escapeHtml(holiday.name)}</span>
            <span class="holiday-type ${holiday.type}">${isLocal ? 'Local' : 'Nacional'}</span>
            ${isEditable ? `
                <div class="holiday-actions">
                    <button class="btn btn-secondary btn-icon" onclick="editHoliday('${holiday._id}')" title="Editar">✏️</button>
                    <button class="btn btn-secondary btn-icon" onclick="deleteHoliday('${holiday._id}')" title="Eliminar">🗑️</button>
                </div>
            ` : ''}
        </div>
    `;
}

// ==================== NAV ====================

function showLocationsView() {
    currentView = 'locations';
    currentLocationId = null;
    currentStoreId = null;

    document.getElementById('locations-view').style.display = 'block';
    document.getElementById('stores-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'none';

    loadLocations();
}

function showStoresView(locationId) {
    currentView = 'stores';
    currentLocationId = locationId;
    currentStoreId = null;

    document.getElementById('locations-view').style.display = 'none';
    document.getElementById('stores-view').style.display = 'block';
    document.getElementById('calendar-view').style.display = 'none';

    loadStores(locationId);
}

function showCalendarView(locationId, storeId) {
    currentView = 'calendar';
    currentLocationId = locationId;
    currentStoreId = storeId;

    // Reset cache al cambiar de tienda
    currentStoreEmployees = null;
    currentStoreEmployeesStoreName = null;
    const employeesContainer = document.getElementById('store-employees-container');
    if (employeesContainer) employeesContainer.innerHTML = '';

    document.getElementById('locations-view').style.display = 'none';
    document.getElementById('stores-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'block';

    loadCalendar();
}

function goBackToStores() {
    if (currentLocationId) {
        showStoresView(currentLocationId);
    }
}

// ==================== MODAL - UBICACIÓN ====================

function openLocationModal(locationId = null) {
    const modal = document.getElementById('location-modal');
    const title = document.getElementById('location-modal-title');
    const form = document.getElementById('location-form');

    if (!modal || !title || !form) return;
    form.reset();

    document.getElementById('location-id').value = locationId || '';

    if (locationId) {
        title.textContent = 'Editar Ubicación';
        const location = locations.find(l => l._id === locationId);
        if (location) {
            document.getElementById('location-name').value = location.name;
            document.getElementById('location-description').value = location.description || '';
        }
    } else {
        title.textContent = 'Nueva Ubicación';
    }

    modal.classList.add('active');
}

function closeLocationModal() {
    const modal = document.getElementById('location-modal');
    if (modal) modal.classList.remove('active');
}

async function handleLocationSubmit(e) {
    e.preventDefault();

    const locationId = document.getElementById('location-id').value;
    const name = document.getElementById('location-name').value.trim();
    const description = document.getElementById('location-description').value.trim();

    if (!name) {
        showError('El nombre de la ubicación es requerido');
        return;
    }

    const payload = { name, description };

    try {
        showLoading(locationId ? 'Actualizando ubicación...' : 'Creando ubicación...');
        const result = locationId
            ? await apiRequest(`/api/locations/${locationId}`, 'PUT', payload)
            : await apiRequest('/api/locations', 'POST', payload);

        if (!result) {
            hideLoading();
            return;
        }

        showSuccess(locationId ? 'Ubicación actualizada correctamente' : 'Ubicación creada correctamente');
        closeLocationModal();
        await loadLocations();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al guardar ubicación: ' + (error?.message || 'Error desconocido'));
    }
}

function editLocation(locationId) {
    openLocationModal(locationId);
}

async function deleteLocation(locationId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta ubicación? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        showLoading('Eliminando ubicación...');
        const result = await apiRequest(`/api/locations/${locationId}`, 'DELETE');
        if (!result) {
            hideLoading();
            return;
        }

        showSuccess('Ubicación eliminada correctamente');
        await loadLocations();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al eliminar ubicación: ' + (error?.message || 'Error desconocido'));
    }
}

// ==================== MODAL - TIENDA ====================

function openStoreModal(storeId = null) {
    const modal = document.getElementById('store-modal');
    const title = document.getElementById('store-modal-title');
    const form = document.getElementById('store-form');

    if (!modal || !title || !form) return;
    form.reset();

    document.getElementById('store-id').value = storeId || '';

    if (storeId) {
        title.textContent = 'Editar Tienda';
        const store = currentLocation?.stores?.find(s => s._id === storeId);
        if (store) {
            document.getElementById('store-name').value = store.name;
            document.getElementById('store-address').value = store.address || '';
        }
    } else {
        title.textContent = 'Nueva Tienda';
    }

    modal.classList.add('active');
}

function closeStoreModal() {
    const modal = document.getElementById('store-modal');
    if (modal) modal.classList.remove('active');
}

async function handleStoreSubmit(e) {
    e.preventDefault();

    const storeId = document.getElementById('store-id').value;
    const name = document.getElementById('store-name').value.trim();
    const address = document.getElementById('store-address').value.trim();
    if (!name) {
        showError('El nombre de la tienda es requerido');
        return;
    }

    const payload = { name, address };

    try {
        showLoading(storeId ? 'Actualizando tienda...' : 'Creando tienda...');

        const result = storeId
            ? await apiRequest(`/api/locations/${currentLocationId}/stores/${storeId}`, 'PUT', payload)
            : await apiRequest(`/api/locations/${currentLocationId}/stores`, 'POST', payload);

        if (!result) {
            hideLoading();
            return;
        }

        showSuccess(storeId ? 'Tienda actualizada correctamente' : 'Tienda creada correctamente');
        closeStoreModal();
        await loadStores(currentLocationId);
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al guardar tienda: ' + (error?.message || 'Error desconocido'));
    }
}

function editStore(locationId, storeId) {
    currentLocationId = locationId;
    openStoreModal(storeId);
}

async function deleteStore(storeId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta tienda? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        showLoading('Eliminando tienda...');
        const result = await apiRequest(`/api/locations/${currentLocationId}/stores/${storeId}`, 'DELETE');
        if (!result) {
            hideLoading();
            return;
        }
        showSuccess('Tienda eliminada correctamente');
        await loadStores(currentLocationId);
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al eliminar tienda: ' + (error?.message || 'Error desconocido'));
    }
}

// ==================== MODAL - FESTIVO ====================

function openHolidayModal(holidayId = null) {
    const modal = document.getElementById('holiday-modal');
    const title = document.getElementById('holiday-modal-title');
    const form = document.getElementById('holiday-form');

    if (!modal || !title || !form) return;
    form.reset();

    document.getElementById('holiday-id').value = holidayId || '';

    if (holidayId) {
        title.textContent = 'Editar Festivo Local';
        const h = currentCalendar?.holidays?.find(x => String(x._id) === String(holidayId));
        if (h) {
            const d = new Date(h.date);
            if (!Number.isNaN(d.getTime())) {
                document.getElementById('holiday-date').value = d.toISOString().slice(0, 10);
            }
            document.getElementById('holiday-name').value = h.name || '';
            document.getElementById('holiday-recurring').checked = !!h.isRecurring;
        }
    } else {
        title.textContent = 'Añadir Festivo Local';
        const today = new Date();
        document.getElementById('holiday-date').value = today.toISOString().slice(0, 10);
    }

    modal.classList.add('active');
}

function closeHolidayModal() {
    const modal = document.getElementById('holiday-modal');
    if (modal) modal.classList.remove('active');
}

async function handleHolidaySubmit(e) {
    e.preventDefault();

    const holidayId = document.getElementById('holiday-id').value;
    const date = document.getElementById('holiday-date').value;
    const name = document.getElementById('holiday-name').value.trim();
    const isRecurring = document.getElementById('holiday-recurring').checked;

    if (!date || !name) {
        showError('Fecha y nombre son requeridos');
        return;
    }

    const payload = { date, name, isRecurring };

    try {
        showLoading(holidayId ? 'Actualizando festivo...' : 'Añadiendo festivo...');

        const result = holidayId
            ? await apiRequest(
                `/api/locations/${currentLocationId}/stores/${currentStoreId}/holidays/${holidayId}`,
                'PUT',
                payload
            )
            : await apiRequest(
                `/api/locations/${currentLocationId}/stores/${currentStoreId}/holidays`,
                'POST',
                payload
            );

        if (!result) {
            hideLoading();
            return;
        }

        showSuccess(holidayId ? 'Festivo actualizado correctamente' : 'Festivo añadido correctamente');
        closeHolidayModal();
        await loadCalendar();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al guardar festivo: ' + (error?.message || 'Error desconocido'));
    }
}

function editHoliday(holidayId) {
    openHolidayModal(holidayId);
}

async function deleteHoliday(holidayId) {
    if (!confirm('¿Estás seguro de que quieres eliminar este festivo local?')) {
        return;
    }

    try {
        showLoading('Eliminando festivo...');
        const result = await apiRequest(
            `/api/locations/${currentLocationId}/stores/${currentStoreId}/holidays/${holidayId}`,
            'DELETE'
        );

        if (!result) {
            hideLoading();
            return;
        }

        showSuccess('Festivo eliminado correctamente');
        await loadCalendar();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al eliminar festivo: ' + (error?.message || 'Error desconocido'));
    }
}

// ==================== UTIL ====================

function showLoading(message = 'Cargando...') {
    console.log(message);
}

function hideLoading() {
    // Placeholder
}

function showSuccess(message) {
    if (typeof showAlert === 'function') {
        showAlert(message, 'success');
        return;
    }
    alert('✅ ' + message);
}

function showError(message) {
    if (typeof showAlert === 'function') {
        showAlert(message, 'error');
        return;
    }
    alert('❌ ' + message);
}

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/*
// Estado de la aplicación
let currentView = 'locations';
let currentLocationId = null;
let currentStoreId = null;
let currentYear = new Date().getFullYear();
let currentUser = null;
let locations = [];

// Meses en español
const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Wrapper compatible (había código que llamaba apiRequest(path, method, data)).
// Internamente reutiliza callAPI() de public/js/api.js.
async function apiRequest(urlOrPath, method = 'GET', data) {
    let url = urlOrPath;
    if (typeof url === 'string' && url.startsWith('/api/')) {
        url = `${API_URL}${url.slice(4)}`; // /api/locations -> ${API_URL}/locations
    }

    const options = {};
    const upperMethod = (method || 'GET').toUpperCase();
    if (upperMethod !== 'GET') {
        options.method = upperMethod;
    }
    if (data !== undefined && upperMethod !== 'GET') {
        options.body = JSON.stringify(data);
    }

    return callAPI(url, options);
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    currentUser = getUser();
    
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    // Mostrar nombre de usuario
    document.getElementById('navbar-username').textContent = currentUser.name || currentUser.username;

    // Cargar branding
    if (typeof loadBranding === 'function') {
        await loadBranding();
    }

    // Verificar permisos
    if (currentUser.role !== 'admin' && currentUser.role !== 'store_coordinator') {
        alert('No tienes permisos para acceder a esta sección');
        window.location.href = 'employee-dashboard.html';
        return;
    }

    // Configurar selector de año
    setupYearSelector();

    // Configurar event listeners
    setupEventListeners();

    // Cargar ubicaciones
    await loadLocations();
});

function setupEventListeners() {
    // Botones de añadir
    document.getElementById('btn-add-location').addEventListener('click', () => openLocationModal());
    document.getElementById('btn-add-store').addEventListener('click', () => openStoreModal());
    document.getElementById('btn-add-holiday').addEventListener('click', () => openHolidayModal());

    // Formularios
    document.getElementById('location-form').addEventListener('submit', handleLocationSubmit);
    document.getElementById('store-form').addEventListener('submit', handleStoreSubmit);
    document.getElementById('holiday-form').addEventListener('submit', handleHolidaySubmit);

    // Selector de año
    document.getElementById('year-selector').addEventListener('change', (e) => {
        currentYear = parseInt(e.target.value);
        loadCalendar();
    });

    // Cerrar modales al hacer clic fuera
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });
}

function setupYearSelector() {
    const selector = document.getElementById('year-selector');
    const currentYear = new Date().getFullYear();
    
    for (let year = currentYear - 2; year <= currentYear + 5; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentYear) option.selected = true;
        selector.appendChild(option);
    }
}

// ==================== CARGAR DATOS ====================

async function loadLocations() {
    try {
        showLoading('Cargando ubicaciones...');
        const data = await callAPI(`${API_URL}/locations`);
        
        if (!data) {
            hideLoading();
            return;
        }
        
        locations = data;
        
        renderLocations();
        hideLoading();

        // Mostrar botón de añadir ubicación solo para admin
        if (currentUser.role === 'admin') {
            document.getElementById('btn-add-location').style.display = 'block';
        }
    } catch (error) {
        hideLoading();
        console.error('Error cargando ubicaciones:', error);
        showError('Error al cargar ubicaciones: ' + (error.message || 'Error desconocido'));
    }
}

async function loadStores(locationId) {
    try {
        showLoading('Cargando tiendas...');
        const location = await callAPI(`${API_URL}/locations/${locationId}`);
        
        if (!location) {
            hideLoading();
            return;
        }
        
        currentLocationId = locationId;
        
        renderStores(location);
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando tiendas:', error);
        showError('Error al cargar tiendas: ' + (error.message || 'Error desconocido'));
    }callAPI(
            `${API_URL}/locations/${currentLocationId}/stores/${currentStoreId}/calendar/${currentYear}`
        );
        
        if (!data) {
            hideLoading();
            return;
        }
async function loadCalendar() {
    try {
        showLoading('Cargando calendario...');
        const data = await apiRequest(
            `/api/locations/${currentLocationId}/stores/${currentStoreId}/calendar/${currentYear}`
        );
        
        renderCalendar(data);
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando calendario:', error);
        showError('Error al cargar calendario: ' + (error.message || 'Error desconocido'));
    }
}

// ==================== RENDERIZADO ====================

function renderLocations() {
    const container = document.getElementById('locations-container');
    
    if (!locations || locations.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📍</div>
                <div class="empty-state-text">No hay ubicaciones disponibles</div>
                ${currentUser.role === 'admin' ? 
                    '<button class="btn btn-primary" onclick="openLocationModal()">➕ Crear Primera Ubicación</button>' : ''}
            </div>
        `;
        return;
    }

    container.innerHTML = locations.map(location => {
        const storeCount = location.stores ? location.stores.length : 0;
        
        return `
            <div class="location-card" onclick="showStoresView('${location._id}')">
                <div class="location-card-header">
                    <h3 class="location-card-title">📍 ${escapeHtml(location.name)}</h3>
                    ${currentUser.role === 'admin' ? `
                        <button class="btn btn-secondary btn-icon" onclick="event.stopPropagation(); editLocation('${location._id}')" title="Editar">
                            ✏️
                        </button>
                    ` : ''}
                </div>
                ${location.description ? `
                    <div class="location-card-description">${escapeHtml(location.description)}</div>
                ` : ''}
                <div class="location-card-stats">
                    <div class="location-card-stat">
                        <span>🏪</span>
                        <span>${storeCount} ${storeCount === 1 ? 'tienda' : 'tiendas'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderStores(location) {
    const container = document.getElementById('stores-container');
    const title = document.getElementById('stores-view-title');
    const breadcrumb = document.getElementById('breadcrumb-location-name');
    
    title.textContent = `🏪 Tiendas en ${location.name}`;
    breadcrumb.textContent = location.name;

    if (!location.stores || location.stores.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🏪</div>
                <div class="empty-state-text">No hay tiendas en esta ubicación</div>
                ${currentUser.role === 'admin' ? 
                    '<button class="btn btn-primary" onclick="openStoreModal()">➕ Añadir Primera Tienda</button>' : ''}
            </div>
        `;
        return;
    }

    container.innerHTML = location.stores.map(store => `
        <div class="store-card" onclick="showCalendarView('${location._id}', '${store._id}')">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <div class="store-card-title">🏪 ${escapeHtml(store.name)}</div>
                    ${store.address ? `
                        <div class="store-card-address">📍 ${escapeHtml(store.address)}</div>
                    ` : ''}
                    <div style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
                        ${store.localHolidays ? store.localHolidays.length : 0} festivos locales
                    </div>
                </div>
                ${currentUser.role === 'admin' ? `
                    <button class="btn btn-secondary btn-icon" 
                            onclick="event.stopPropagation(); editStore('${location._id}', '${store._id}')" 
                            title="Editar">
                        ✏️
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Mostrar botón de añadir tienda solo para admin
    if (currentUser.role === 'admin') {
        document.getElementById('btn-add-store').style.display = 'block';
    }
}

function renderCalendar(data) {
    const title = document.getElementById('calendar-store-title');
    const breadcrumbLocation = document.getElementById('breadcrumb-location-link');
    const breadcrumbStore = document.getElementById('breadcrumb-store-name');
    const container = document.getElementById('calendar-grid');

    title.textContent = `📅 ${data.storeName} - ${data.year}`;
    breadcrumbLocation.textContent = data.locationName;
    breadcrumbStore.textContent = data.storeName;

    // Agrupar festivos por mes
    const holidaysByMonth = {};
    for (let i = 0; i < 12; i++) {
        holidaysByMonth[i] = [];
    }

    data.holidays.forEach(holiday => {
        const date = new Date(holiday.date);
        const month = date.getMonth();
        holidaysByMonth[month].push(holiday);
    });

    // Renderizar meses
    container.innerHTML = MONTHS.map((monthName, index) => {
        const monthHolidays = holidaysByMonth[index];
        
        return `
            <div class="month-section">
                <div class="month-title">${monthName}</div>
                ${monthHolidays.length === 0 ? 
                    '<div style="color: var(--text-secondary); font-size: 0.85rem; padding: 0.5rem;">Sin festivos</div>' :
                    monthHolidays.map(holiday => renderHolidayItem(holiday)).join('')
                }
            </div>
        `;
    }).join('');
}

function renderHolidayItem(holiday) {
    const date = new Date(holiday.date);
    const dateStr = `${date.getDate()}/${date.getMonth() + 1}`;
    const isLocal = holiday.type === 'local';
    const isEditable = isLocal && (currentUser.role === 'admin' || currentUser.role === 'store_coordinator');

    return `
        <div class="holiday-item ${holiday.type}">
            <span class="holiday-date">${dateStr}</span>
            <span class="holiday-name" title="${escapeHtml(holiday.name)}">${escapeHtml(holiday.name)}</span>
            <span class="holiday-type ${holiday.type}">${isLocal ? 'Local' : 'Nacional'}</span>
            ${isEditable ? `
                <div class="holiday-actions">
                    <button class="btn btn-secondary btn-icon" 
                            onclick="editHoliday('${holiday._id}')" 
                            title="Editar">
                        ✏️
                    </button>
                    <button class="btn btn-danger btn-icon" 
                            onclick="deleteHoliday('${holiday._id}')" 
                            title="Eliminar">
                        🗑️
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

// ==================== NAVEGACIÓN ====================

function showLocationsView() {
    currentView = 'locations';
    currentLocationId = null;
    currentStoreId = null;
    
    document.getElementById('locations-view').style.display = 'block';
    document.getElementById('stores-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'none';
    
    loadLocations();
}

function showStoresView(locationId) {
    try {
        showLoading('Cargando tiendas...');
        const location = await apiRequest(`/api/locations/${locationId}`);

        if (!location) {
            hideLoading();
            return;
        }

        currentLocationId = locationId;
        renderStores(location);
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando tiendas:', error);
        showError('Error al cargar tiendas: ' + (error.message || 'Error desconocido'));
    }
        showStoresView(currentLocationId);

async function loadCalendar() {
    try {
        showLoading('Cargando calendario...');
        const data = await apiRequest(
            `/api/locations/${currentLocationId}/stores/${currentStoreId}/calendar/${currentYear}`
        );

        if (!data) {
            hideLoading();
            return;
        }

        renderCalendar(data);
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando calendario:', error);
        showError('Error al cargar calendario: ' + (error.message || 'Error desconocido'));
    }
}
        if (location) {
            document.getElementById('location-name').value = location.name;
            document.getElementById('location-description').value = location.description || '';
        }
    } else {
        title.textContent = 'Nueva Ubicación';
    }
    
    modal.style.display = 'block';
}

function closeLocationModal() {
    document.getElementById('location-modal').style.display = 'none';
}

async function handleLocationSubmit(e) {
    e.preventDefault();
    
    const locationId = document.getElementById('location-id').value;
    const name = document.getElementById('location-name').value.trim();
    const description = document.getElementById('location-description').value.trim();
    
    if (!name) {
        showError('El nombre de la ubicación es requerido');
        return;
    }
    
    try {
        showLoadincallAPI(`${API_URL}/locations/${locationId}`, 'PUT', data);
            showSuccess('Ubicación actualizada correctamente');
        } else {
            await callAPI(`${API_URL}/locations`
        if (locationId) {
            await apiRequest(`/api/locations/${locationId}`, 'PUT', data);
            showSuccess('Ubicación actualizada correctamente');
        } else {
            await apiRequest('/api/locations', 'POST', data);
            showSuccess('Ubicación creada correctamente');
        }
        
        closeLocationModal();
        await loadLocations();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al guardar ubicación: ' + (error.message || 'Error desconocido'));
    }
}

function editLocation(locationId) {
    openLocationModal(locationId);
}

async function deleteLocation(locationId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta ubicación? Esta acción no se puede deshacer.')) {
        returncallAPI(`${API_URL}/locations/${locationId}`, { method: 'DELETE' }
    }
    
    try {
        showLoading('Eliminando ubicación...');
        await apiRequest(`/api/locations/${locationId}`, 'DELETE');
        showSuccess('Ubicación eliminada correctamente');
        await loadLocations();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al eliminar ubicación: ' + (error.message || 'Error desconocido'));
    }
}

// ==================== MODALES - TIENDA ====================

function openStoreModal(storeId = null) {
    const modal = document.getElementById('store-modal');
    const title = document.getElementById('store-modal-title');
    const form = document.getElementById('store-form');
    
    form.reset();
    document.getElementById('store-id').value = storeId || '';
    
    if (storeId) {
        title.textContent = 'Editar Tienda';
        const location = locations.find(l => l._id === currentLocationId);
        if (location) {
            const store = location.stores.find(s => s._id === storeId);
            if (store) {
                document.getElementById('store-name').value = store.name;
                document.getElementById('store-address').value = store.address || '';
            }
        }
    } else {
        title.textContent = 'Nueva Tienda';
    }
    
    modal.style.display = 'block';
}

function closeStoreModal() {
    document.getElementById('store-modal').style.display = 'none';
}

async function handleStoreSubmit(e) {
    e.preventDefault();
    
    const storeId = document.getElementById('store-id').value;
    const name = document.getElementById('store-name').value.trim();
    const address = document.getElementById('store-address').value.trim();
    
    if (!name) {
        showError('El nombre de la tienda es requerido');
        return;
    }
    
    try {
        showLoadincallAPI(`${API_URL}/locations/${currentLocationId}/stores/${storeId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showSuccess('Tienda actualizada correctamente');
        } else {
            await callAPI(`${API_URL}/locations/${currentLocationId}/stores`, {
                method: 'POST',
                body: JSON.stringify(data)
            }
        if (storeId) {
            await apiRequest(`/api/locations/${currentLocationId}/stores/${storeId}`, 'PUT', data);
            showSuccess('Tienda actualizada correctamente');
        } else {
            await apiRequest(`/api/locations/${currentLocationId}/stores`, 'POST', data);
            showSuccess('Tienda creada correctamente');
        }
        
        closeStoreModal();
        await loadStores(currentLocationId);
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al guardar tienda: ' + (error.message || 'Error desconocido'));
    }
}

function editStore(locationId, storeId) {
    currentLocationId = locationId;
    openStoreModal(storeId);
}

async function deleteStore(storeId) {
    if (!conficallAPI(`${API_URL}/locations/${currentLocationId}/stores/${storeId}`, { method: 'DELETE' }de deshacer.')) {
        return;
    }
    
    try {
        showLoading('Eliminando tienda...');
        await apiRequest(`/api/locations/${currentLocationId}/stores/${storeId}`, 'DELETE');
        showSuccess('Tienda eliminada correctamente');
        await loadStores(currentLocationId);
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al eliminar tienda: ' + (error.message || 'Error desconocido'));
    }
}

// ==================== MODALES - FESTIVO ====================

function openHolidayModal(holidayId = null) {
    const modal = document.getElementById('holiday-modal');
    const title = document.getElementById('holiday-modal-title');
    const form = document.getElementById('holiday-form');
    
    form.reset();
    document.getElementById('holiday-id').value = holidayId || '';
    
    if (holidayId) {
        title.textContent = 'Editar Festivo Local';
        // Buscar el festivo en los datos actuales
        // Nota: Necesitarás cargar los datos del festivo si no los tienes
    } else {
        title.textContent = 'Añadir Festivo Local';
        // Establecer año actual por defecto
        const today = new Date();
        document.getElementById('holiday-date').value = today.toISOString().split('T')[0];
    }
    
    modal.style.display = 'block';
}

function closeHolidayModal() {
    document.getElementById('holiday-modal').style.display = 'none';
}

async function handleHolidaySubmit(e) {
    e.preventDefault();
    
    const holidayId = document.getElementById('holiday-id').value;
    const date = document.getElementById('holiday-date').value;
    const name = document.getElementById('holiday-name').value.trim();
    const isRecurring = document.getElementById('holiday-recurring').checked;
    
    if (!date || !name) {
        showError('Fecha y nombre son requeridos');
        return;
    }
    
    try {callAPI(
                `${API_URL}/locations/${currentLocationId}/stores/${currentStoreId}/holidays/${holidayId}`,
                {
                    method: 'PUT',
                    body: JSON.stringify(data)
                }
            );
            showSuccess('Festivo actualizado correctamente');
        } else {
            await callAPI(
                `${API_URL}/locations/${currentLocationId}/stores/${currentStoreId}/holidays`,
                {
                    method: 'POST',
                    body: JSON.stringify(data)
                }
            showSuccess('Festivo actualizado correctamente');
        } else {
            await apiRequest(
                `/api/locations/${currentLocationId}/stores/${currentStoreId}/holidays`,
                'POST',
                data
            );
            showSuccess('Festivo añadido correctamente');
        }
        
        closeHolidayModal();
        await loadCalendar();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al guardar festivo: ' + (error.message || 'Error desconocido'));
    }
}

function editHoliday(holidayId) {
    openHolidacallAPI(
            `${API_URL}/locations/${currentLocationId}/stores/${currentStoreId}/holidays/${holidayId}`,
            { method: 'DELETE' }
async function deleteHoliday(holidayId) {
    if (!confirm('¿Estás seguro de que quieres eliminar este festivo local?')) {
        return;
    }
    
    try {
        showLoading('Eliminando festivo...');
        await apiRequest(
            `/api/locations/${currentLocationId}/stores/${currentStoreId}/holidays/${holidayId}`,
            'DELETE'
        );
        showSuccess('Festivo eliminado correctamente');
        await loadCalendar();
        hideLoading();
    } catch (error) {
        hideLoading();
        showError('Error al eliminar festivo: ' + (error.message || 'Error desconocido'));
    }
}

// ==================== UTILIDADES ====================

function showLoading(message = 'Cargando...') {
    // Puedes implementar un loader global aquí
    console.log(message);
}

function hideLoading() {
    // Ocultar loader global
}

function showSuccess(message) {
    alert('✅ ' + message);
}

function showError(message) {
    alert('❌ ' + message);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function logout() {
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}

*/
