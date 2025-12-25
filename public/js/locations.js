// Estado de la aplicación (locations module)
let currentView = 'locations';
let currentLocationId = null;
let currentStoreId = null;
let currentYear = new Date().getFullYear();
let currentUser = null;

let locations = [];
let currentCalendar = null; // { year, locationName, storeName, holidays: [] }
let currentLocation = null; // ubicación cargada en vista tiendas

// Vista de gestión de empleados por ubicación (pestaña)
let employeesViewLocation = null; // { _id, name, stores: [...] }
let employeesViewEmployees = []; // [{ _id, full_name, dni, position, location }]

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
    document.getElementById('btn-export-employees-location')?.addEventListener('click', exportEmployeesPdfForCurrentLocation);
    document.getElementById('btn-export-employees-all')?.addEventListener('click', exportEmployeesPdfForAllLocations);

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

        // Preparar multiselect de tiendas para exportación global
        if (currentUser.role === 'admin') {
            populateGlobalStoreMultiSelect();
        }

        if (currentUser.role === 'admin') {
            const btn = document.getElementById('btn-add-location');
            if (btn) btn.style.display = 'block';

            const btnExportAll = document.getElementById('btn-export-employees-all');
            if (btnExportAll) btnExportAll.style.display = 'inline-flex';

            const sel = document.getElementById('employee-export-stores-all');
            if (sel) sel.style.display = 'block';
        }

        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando ubicaciones:', error);
        showError('Error al cargar ubicaciones: ' + (error?.message || 'Error desconocido'));
    }
}

function populateGlobalStoreMultiSelect() {
    const sel = document.getElementById('employee-export-stores-all');
    if (!sel) return;

    const prevSelected = new Set(Array.from(sel.selectedOptions || []).map(o => String(o.value)));

    const opts = [];
    for (const loc of (Array.isArray(locations) ? locations : [])) {
        if (!loc) continue;
        const locName = String(loc.name || '');
        for (const s of (Array.isArray(loc.stores) ? loc.stores : [])) {
            const storeName = String(s && s.name ? s.name : '').trim();
            if (!storeName) continue;
            opts.push({
                value: storeName,
                label: `${locName} · ${storeName}`
            });
        }
    }

    // Deduplicar por nombre (Employee.location guarda el nombre de tienda)
    const byValue = new Map();
    for (const o of opts) {
        const key = normalizeForCompare(o.value);
        if (!byValue.has(key)) byValue.set(key, o);
    }

    const unique = Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label, 'es'));

    sel.innerHTML = '';
    for (const o of unique) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (prevSelected.has(o.value)) opt.selected = true;
        sel.appendChild(opt);
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
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error cargando calendario:', error);
        showError('Error al cargar calendario: ' + (error?.message || 'Error desconocido'));
    }
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
        const canManageNonFactoryStores = currentUser.role === 'admin' && !isFactoryName(location?.name);
        return `
            <div class="location-card" onclick="showStoresView('${location._id}')">
                <div class="location-card-header">
                    <h3 class="location-card-title">📍 ${escapeHtml(location.name)}</h3>
                    ${currentUser.role === 'admin' ? `
                        ${canManageNonFactoryStores ? `<button class="btn btn-secondary btn-icon" onclick="event.stopPropagation(); openStoreMoveModal('${location._id}')" title="Gestionar tiendas (no fábrica)">↔️</button>` : ''}
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
    document.getElementById('employees-view').style.display = 'none';

    employeesViewLocation = null;
    employeesViewEmployees = [];

    loadLocations();
}

function showStoresView(locationId) {
    currentView = 'stores';
    currentLocationId = locationId;
    currentStoreId = null;

    document.getElementById('locations-view').style.display = 'none';
    document.getElementById('stores-view').style.display = 'block';
    document.getElementById('calendar-view').style.display = 'none';
    document.getElementById('employees-view').style.display = 'none';

    setLocationTabsVisibility();
    setActiveLocationTab('stores');

    loadStores(locationId);
}

function showCalendarView(locationId, storeId) {
    currentView = 'calendar';
    currentLocationId = locationId;
    currentStoreId = storeId;

    document.getElementById('locations-view').style.display = 'none';
    document.getElementById('stores-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'block';
    document.getElementById('employees-view').style.display = 'none';

    loadCalendar();
}

function goBackToStores() {
    if (currentLocationId) {
        showStoresView(currentLocationId);
    }
}

function goToEmployeesTab() {
    if (currentLocationId) {
        showEmployeesView(currentLocationId);
    }
}

function goToStoresTab() {
    if (currentLocationId) {
        showStoresView(currentLocationId);
    }
}

function setLocationTabsVisibility() {
    const visible = !!currentUser && currentUser.role === 'admin';
    const el1 = document.getElementById('location-tabs-stores');
    const el2 = document.getElementById('location-tabs-employees');
    if (el1) el1.style.display = visible ? 'flex' : 'none';
    if (el2) el2.style.display = visible ? 'flex' : 'none';
}

function setActiveLocationTab(active) {
    const pairs = [
        { stores: document.getElementById('tab-stores-stores'), employees: document.getElementById('tab-employees-stores') },
        { stores: document.getElementById('tab-stores-employees'), employees: document.getElementById('tab-employees-employees') }
    ];

    for (const p of pairs) {
        if (!p.stores || !p.employees) continue;
        if (active === 'employees') {
            p.stores.className = 'btn btn-secondary';
            p.employees.className = 'btn btn-primary';
        } else {
            p.stores.className = 'btn btn-primary';
            p.employees.className = 'btn btn-secondary';
        }
    }
}

async function showEmployeesView(locationId) {
    if (!currentUser || currentUser.role !== 'admin') {
        showError('Solo administradores pueden gestionar empleados por ubicación');
        return;
    }

    currentView = 'employees';
    currentLocationId = locationId;
    currentStoreId = null;

    document.getElementById('locations-view').style.display = 'none';
    document.getElementById('stores-view').style.display = 'none';
    document.getElementById('calendar-view').style.display = 'none';
    document.getElementById('employees-view').style.display = 'block';

    setLocationTabsVisibility();
    setActiveLocationTab('employees');

    await loadEmployeesForLocation(locationId);
}

async function loadEmployeesForLocation(locationId) {
    const title = document.getElementById('employees-view-title');
    const breadcrumb = document.getElementById('breadcrumb-location-link-employees');
    const body = document.getElementById('employees-view-body');
    if (!body) return;

    body.innerHTML = '<div style="color: var(--text-muted); padding: 0.75rem;">Cargando empleados...</div>';

    try {
        const location = await apiRequest(`/api/locations/${locationId}`);
        if (!location) return;

        // Mantener cache local actualizado
        locations = (locations || []).map(l => (String(l._id) === String(locationId) ? location : l));

        const res = await apiRequest(`/api/locations/${locationId}/employees`);
        const employees = res && Array.isArray(res.employees) ? res.employees : [];

        employeesViewLocation = location;
        employeesViewEmployees = employees;

        if (title) title.textContent = `👥 Empleados · ${location.name}`;
        if (breadcrumb) breadcrumb.textContent = location.name;

        const btnExport = document.getElementById('btn-export-employees-location');
        if (btnExport) btnExport.style.display = (currentUser && currentUser.role === 'admin') ? 'inline-flex' : 'none';

        const sel = document.getElementById('employee-export-stores-location');
        if (sel) {
            sel.style.display = (currentUser && currentUser.role === 'admin') ? 'block' : 'none';
            populateLocationStoreMultiSelect();
        }

        renderEmployeesView();
    } catch (error) {
        console.error('Error cargando empleados por ubicación:', error);
        body.innerHTML = '<div class="empty-state"><div class="empty-state-text">No se pudieron cargar los empleados</div></div>';
    }
}

function populateLocationStoreMultiSelect() {
    const sel = document.getElementById('employee-export-stores-location');
    if (!sel || !employeesViewLocation) return;

    const prevSelected = new Set(Array.from(sel.selectedOptions || []).map(o => String(o.value)));

    const stores = (Array.isArray(employeesViewLocation.stores) ? employeesViewLocation.stores : [])
        .map(s => String(s && s.name ? s.name : '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es'));

    sel.innerHTML = '';
    for (const name of stores) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (prevSelected.has(name)) opt.selected = true;
        sel.appendChild(opt);
    }
}

function getSelectedValues(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return [];
    return Array.from(sel.selectedOptions || []).map(o => String(o.value || '').trim()).filter(Boolean);
}

function formatDateTimeForPdf(d = new Date()) {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
}

function safeFileToken(value) {
    return String(value || '').trim().replace(/[^\w\-.]+/g, '_').slice(0, 80) || 'documento';
}

function ensurePdfReady() {
    if (!window.jspdf) {
        showError('Error: La librería PDF no está cargada.');
        return false;
    }
    if (typeof reportsUtil === 'undefined' || !reportsUtil) {
        showError('Error: Utilidades de PDF no disponibles.');
        return false;
    }
    return true;
}

async function exportEmployeesPdfForCurrentLocation() {
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!employeesViewLocation || !employeesViewLocation._id) return;
    if (!ensurePdfReady()) return;

    try {
        showLoading('Generando PDF...');
        await reportsUtil.loadConfig();

        const locationId = String(employeesViewLocation._id);
        const locationName = String(employeesViewLocation.name || 'Ubicación');

        // Refrescamos datos para exportar lo más reciente
        const res = await apiRequest(`/api/locations/${locationId}/employees`);
        let employees = res && Array.isArray(res.employees) ? res.employees : [];

        const selectedStores = getSelectedValues('employee-export-stores-location');
        if (selectedStores.length > 0) {
            const set = new Set(selectedStores.map(s => normalizeForCompare(s)));
            employees = employees.filter(e => set.has(normalizeForCompare(e && e.location ? e.location : '')));
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(`EMPLEADOS · ${locationName}`, 14, 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Generado: ${formatDateTimeForPdf(new Date())}`, 14, 20);

        const head = [["Nombre", "DNI", "Puesto", "Estado", "Tienda/Fábrica"]];
        const body = (employees || []).map(e => {
            const status = e.status === 'active' ? 'Activo' : (e.status === 'on_leave' ? 'Baja' : (e.status || ''));
            return [
                String(e.full_name || e.name || ''),
                String(e.dni || ''),
                String(e.position || ''),
                String(status),
                String(e.location || '')
            ];
        });

        if (body.length === 0) {
            doc.setFontSize(10);
            doc.text('Sin empleados en esta ubicación.', 14, 30);
        } else {
            doc.autoTable({
                head,
                body,
                startY: 26,
                styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
                headStyles: {
                    fillColor: reportsUtil.config.secondaryColor || [30, 41, 59],
                    textColor: [255, 255, 255]
                },
                columnStyles: {
                    0: { cellWidth: 55 },
                    1: { cellWidth: 22 },
                    2: { cellWidth: 38 },
                    3: { cellWidth: 18 },
                    4: { cellWidth: 45 }
                },
                margin: { left: 10, right: 10 }
            });
        }

        const suffix = (getSelectedValues('employee-export-stores-location').length > 0) ? '_filtrado' : '';
        await reportsUtil.savePdf(doc, `Empleados_${safeFileToken(locationName)}${suffix}.pdf`);
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error exportando PDF por ubicación:', error);
        showError('No se pudo exportar el PDF: ' + (error?.message || 'Error desconocido'));
    }
}

async function exportEmployeesPdfForAllLocations() {
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!ensurePdfReady()) return;

    try {
        showLoading('Generando PDF...');
        await reportsUtil.loadConfig();

        const all = await apiRequest('/api/locations');
        const allLocations = Array.isArray(all) ? all : [];

        const selectedStores = getSelectedValues('employee-export-stores-all');
        const selectedStoreSet = new Set(selectedStores.map(s => normalizeForCompare(s)));

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('EMPLEADOS POR UBICACIÓN', 14, 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Generado: ${formatDateTimeForPdf(new Date())}`, 14, 20);

        let cursorY = 28;

        const head = [["Nombre", "DNI", "Puesto", "Estado", "Tienda/Fábrica"]];

        for (const loc of allLocations) {
            if (!loc || !loc._id) continue;
            const locName = String(loc.name || 'Ubicación');

            // Si estamos muy abajo, nueva página
            if (cursorY > 265) {
                doc.addPage();
                cursorY = 14;
            }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.text(locName, 14, cursorY);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);

            const res = await apiRequest(`/api/locations/${String(loc._id)}/employees`);
            let employees = res && Array.isArray(res.employees) ? res.employees : [];

            if (selectedStores.length > 0) {
                employees = employees.filter(e => selectedStoreSet.has(normalizeForCompare(e && e.location ? e.location : '')));
            }

            const body = (employees || []).map(e => {
                const status = e.status === 'active' ? 'Activo' : (e.status === 'on_leave' ? 'Baja' : (e.status || ''));
                return [
                    String(e.full_name || e.name || ''),
                    String(e.dni || ''),
                    String(e.position || ''),
                    String(status),
                    String(e.location || '')
                ];
            });

            if (body.length === 0) {
                doc.setTextColor(100);
                doc.text('Sin empleados.', 14, cursorY + 6);
                doc.setTextColor(0);
                cursorY += 12;
                continue;
            }

            doc.autoTable({
                head,
                body,
                startY: cursorY + 4,
                styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
                headStyles: {
                    fillColor: reportsUtil.config.secondaryColor || [30, 41, 59],
                    textColor: [255, 255, 255]
                },
                columnStyles: {
                    0: { cellWidth: 55 },
                    1: { cellWidth: 22 },
                    2: { cellWidth: 38 },
                    3: { cellWidth: 18 },
                    4: { cellWidth: 45 }
                },
                margin: { left: 10, right: 10 },
                pageBreak: 'auto'
            });

            cursorY = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : (cursorY + 20)) + 10;
        }

        const suffix = selectedStores.length > 0 ? '_filtrado' : '';
        await reportsUtil.savePdf(doc, `Empleados_por_ubicacion_${safeFileToken(formatDateTimeForPdf(new Date()).slice(0, 10))}${suffix}.pdf`);
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error exportando PDF (todas):', error);
        showError('No se pudo exportar el PDF: ' + (error?.message || 'Error desconocido'));
    }
}

function getAllStoresAsTargets() {
    const out = [];
    for (const loc of (Array.isArray(locations) ? locations : [])) {
        if (!loc) continue;
        const stores = Array.isArray(loc.stores) ? loc.stores : [];
        for (const s of stores) {
            if (!s || !s.name) continue;
            out.push({
                locationId: String(loc._id),
                locationName: String(loc.name || ''),
                storeId: String(s._id),
                storeName: String(s.name || '')
            });
        }
    }
    // Deduplicar por nombre de tienda
    const byName = new Map();
    for (const it of out) {
        const key = normalizeForCompare(it.storeName);
        if (!byName.has(key)) byName.set(key, it);
    }
    return Array.from(byName.values()).sort((a, b) => {
        const lc = String(a.locationName).localeCompare(String(b.locationName), 'es');
        if (lc !== 0) return lc;
        return String(a.storeName).localeCompare(String(b.storeName), 'es');
    });
}

function renderEmployeesView() {
    const body = document.getElementById('employees-view-body');
    if (!body || !employeesViewLocation) return;

    const loc = employeesViewLocation;
    const employees = Array.isArray(employeesViewEmployees) ? employeesViewEmployees : [];
    const targets = getAllStoresAsTargets();

    const employeesHtml = employees.length
        ? employees
            .slice()
            .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'es'))
            .map(e => {
                const eid = String(e._id);
                const name = escapeHtml(e.full_name || 'Empleado');
                const dni = escapeHtml(e.dni || '-');
                const pos = escapeHtml(e.position || '-');
                const store = escapeHtml(e.location || '-');
                return `
                    <div class="employee-move-employee" draggable="true" data-employee-id="${eid}" data-from-store="${escapeHtml(e.location || '')}" title="Arrastra para mover">
                        <div class="employee-move-name">👤 ${name}</div>
                        <div class="employee-move-meta">
                            <span>🪪 ${dni}</span>
                            <span>💼 ${pos}</span>
                            <span>🏪 ${store}</span>
                        </div>
                    </div>
                `;
            }).join('')
        : '<div style="color: var(--text-muted); padding: var(--spacing-md);">No hay empleados en esta ubicación</div>';

    const targetsHtml = targets.length
        ? targets.map(t => {
            const label = escapeHtml(`${t.locationName} · ${t.storeName}`);
            return `
                <div class="employee-move-target" data-target-store="${escapeHtml(t.storeName)}" title="${label}">
                    <div class="store-move-target-title">🏪 ${label}</div>
                    <div class="store-move-target-subtitle">Suelta aquí para mover</div>
                </div>
            `;
        }).join('')
        : '<div style="color: var(--text-muted); padding: var(--spacing-md);">No hay tiendas destino disponibles</div>';

    body.innerHTML = `
        <div class="store-move-panel">
            <div class="store-move-panel-title">Empleados en ${escapeHtml(loc.name || '')}</div>
            <div class="employee-move-list">${employeesHtml}</div>
        </div>
        <div class="store-move-panel">
            <div class="store-move-panel-title">Mover a tienda / fábrica</div>
            <div class="employee-move-targets">${targetsHtml}</div>
        </div>
    `;

    body.querySelectorAll('.employee-move-employee').forEach(el => {
        el.addEventListener('dragstart', (e) => {
            const employeeId = el.getAttribute('data-employee-id');
            const fromStoreName = el.getAttribute('data-from-store') || '';
            const payload = { employeeId, fromStoreName };
            try {
                e.dataTransfer.setData('application/json', JSON.stringify(payload));
            } catch {
                e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
            e.dataTransfer.effectAllowed = 'move';
            el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
        });
    });

    body.querySelectorAll('.employee-move-target').forEach(targetEl => {
        targetEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            targetEl.classList.add('drag-over');
        });
        targetEl.addEventListener('dragleave', () => {
            targetEl.classList.remove('drag-over');
        });
        targetEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            targetEl.classList.remove('drag-over');

            let raw = '';
            try {
                raw = e.dataTransfer.getData('application/json');
            } catch {
                raw = '';
            }
            if (!raw) raw = e.dataTransfer.getData('text/plain');

            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                return;
            }

            const employeeId = data && data.employeeId;
            const toStoreName = targetEl.getAttribute('data-target-store');
            if (!employeeId || !toStoreName) return;

            await moveEmployeeToStore({ employeeId, toStoreName });
        });
    });
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

function normalizeForCompare(value) {
    const s = (value == null ? '' : String(value)).trim();
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isFactoryName(value) {
    const normalized = normalizeForCompare(value);
    if (!normalized) return false;
    return normalized.includes('fabrica') || normalized.includes('factory');
}
// ==================== ADMIN: GESTIÓN DRAG & DROP ====================

let storeMoveFromLocation = null; // { _id, name, stores: [...] }

// ==================== ADMIN: DRAG & DROP EMPLEADOS ====================

async function moveEmployeeToStore({ employeeId, toStoreName }) {
    try {
        showLoading('Moviendo empleado...');
        const res = await apiRequest(`/api/employees/${employeeId}/move-store`, 'POST', { toStoreName });
        if (!res) {
            hideLoading();
            return;
        }

        // Refrescar lista de empleados de la vista
        const locId = employeesViewLocation && employeesViewLocation._id;
        if (locId) {
            const refreshed = await apiRequest(`/api/locations/${locId}/employees`);
            employeesViewEmployees = refreshed && Array.isArray(refreshed.employees) ? refreshed.employees : [];
        }
        renderEmployeesView();
        hideLoading();
        showSuccess('Empleado movido correctamente');
    } catch (error) {
        hideLoading();
        console.error('Error moviendo empleado:', error);
        showError('No se pudo mover el empleado: ' + (error?.message || 'Error desconocido'));
    }
}

async function openStoreMoveModal(locationId) {
    if (!currentUser || currentUser.role !== 'admin') return;

    const modal = document.getElementById('store-move-modal');
    const title = document.getElementById('store-move-modal-title');
    const body = document.getElementById('store-move-modal-body');
    if (!modal || !title || !body) return;

    try {
        showLoading('Cargando gestor de tiendas...');
        const location = await apiRequest(`/api/locations/${locationId}`);
        if (!location) {
            hideLoading();
            return;
        }

        // Solo permitimos gestionar tiendas no-fábrica
        if (isFactoryName(location?.name)) {
            hideLoading();
            showError('No se permite gestionar tiendas de Fábrica desde aquí');
            return;
        }

        storeMoveFromLocation = location;
        title.textContent = `Gestionar tiendas · ${location.name}`;
        modal.classList.add('active');
        renderStoreMoveModal();
        hideLoading();
    } catch (error) {
        hideLoading();
        console.error('Error abriendo gestor de tiendas:', error);
        showError('No se pudo abrir el gestor: ' + (error?.message || 'Error desconocido'));
    }
}

function closeStoreMoveModal() {
    const modal = document.getElementById('store-move-modal');
    if (modal) modal.classList.remove('active');
    storeMoveFromLocation = null;
}

function renderStoreMoveModal() {
    const body = document.getElementById('store-move-modal-body');
    if (!body || !storeMoveFromLocation) return;

    const from = storeMoveFromLocation;
    const stores = (Array.isArray(from.stores) ? from.stores : [])
        .filter(s => !isFactoryName(s?.name));
    const otherLocations = (Array.isArray(locations) ? locations : [])
        .filter(l => String(l._id) !== String(from._id))
        .filter(l => !isFactoryName(l?.name));

    const storesHtml = stores.length
        ? stores
            .slice()
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
            .map(store => {
                const sid = String(store._id);
                const sname = escapeHtml(store.name || '');
                return `
                    <div class="store-move-store" draggable="true" data-store-id="${sid}" title="Arrastra para mover">
                        <span>🏪</span>
                        <span class="store-move-store-name">${sname}</span>
                    </div>
                `;
            }).join('')
        : '<div style="color: var(--text-muted); padding: var(--spacing-md);">No hay tiendas no-fábrica en esta ubicación</div>';

    const targetsHtml = otherLocations.length
        ? otherLocations
            .slice()
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
            .map(loc => {
                const lid = String(loc._id);
                const lname = escapeHtml(loc.name || '');
                return `
                    <div class="store-move-target" data-target-location-id="${lid}">
                        <div class="store-move-target-title">📍 ${lname}</div>
                        <div class="store-move-target-subtitle">Suelta aquí para mover</div>
                    </div>
                `;
            }).join('')
        : '<div style="color: var(--text-muted); padding: var(--spacing-md);">No hay otras ubicaciones disponibles</div>';

    body.innerHTML = `
        <div class="store-move-panel">
            <div class="store-move-panel-title">Tiendas en ${escapeHtml(from.name || '')}</div>
            <div id="store-move-store-list" class="store-move-list">${storesHtml}</div>
        </div>
        <div class="store-move-panel">
            <div class="store-move-panel-title">Mover a otra ubicación</div>
            <div id="store-move-target-list" class="store-move-targets">${targetsHtml}</div>
        </div>
    `;

    // Drag sources
    body.querySelectorAll('.store-move-store').forEach(el => {
        el.addEventListener('dragstart', (e) => {
            const storeId = el.getAttribute('data-store-id');
            const payload = {
                storeId,
                fromLocationId: String(from._id)
            };
            try {
                e.dataTransfer.setData('application/json', JSON.stringify(payload));
            } catch {
                e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
            e.dataTransfer.effectAllowed = 'move';
            el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
        });
    });

    // Drop targets
    body.querySelectorAll('.store-move-target').forEach(targetEl => {
        targetEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            targetEl.classList.add('drag-over');
        });
        targetEl.addEventListener('dragleave', () => {
            targetEl.classList.remove('drag-over');
        });
        targetEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            targetEl.classList.remove('drag-over');

            let raw = '';
            try {
                raw = e.dataTransfer.getData('application/json');
            } catch {
                raw = '';
            }
            if (!raw) {
                raw = e.dataTransfer.getData('text/plain');
            }

            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                return;
            }

            const toLocationId = targetEl.getAttribute('data-target-location-id');
            const storeId = data && data.storeId;
            const fromLocationId = data && data.fromLocationId;
            if (!toLocationId || !storeId || !fromLocationId) return;
            if (String(toLocationId) === String(fromLocationId)) return;

            await moveStoreBetweenLocations({ fromLocationId, storeId, toLocationId });
        });
    });
}

async function moveStoreBetweenLocations({ fromLocationId, storeId, toLocationId }) {
    try {
        showLoading('Moviendo tienda...');
        const res = await apiRequest(
            `/api/locations/${fromLocationId}/stores/${storeId}/move`,
            'POST',
            { toLocationId }
        );
        if (!res) {
            hideLoading();
            return;
        }

        await loadLocations();
        // Refrescar ubicación origen en el modal (ya no contiene la tienda movida)
        storeMoveFromLocation = await apiRequest(`/api/locations/${fromLocationId}`);
        renderStoreMoveModal();
        hideLoading();
        showSuccess('Tienda movida correctamente');
    } catch (error) {
        hideLoading();
        console.error('Error moviendo tienda:', error);
        showError('No se pudo mover la tienda: ' + (error?.message || 'Error desconocido'));
    }
}
