/* global API_URL, callAPI, vacationsAPI, reportsUtil, showAlert */

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

function monthToRange(month) {
    // month: YYYY-MM
    const [y, m] = month.split('-').map(n => Number(n));
    const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    return { start, end };
}

function toISODate(d) {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
}

function daysInMonth(month) {
    const { start, end } = monthToRange(month);
    const days = [];
    let cur = new Date(start);
    while (cur.getTime() <= end.getTime()) {
        days.push(toISODate(cur));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
}

function eventLabel(kind) {
    if (kind === 'vacation') return 'V';
    if (kind === 'permission') return 'P';
    if (kind === 'absence') return 'B';
    return '';
}

function buildEventDayMap(events, monthDays) {
    const monthDaySet = new Set(monthDays);
    const byEmp = new Map();

    for (const ev of (events || [])) {
        const empId = ev && ev.employee && ev.employee.id ? String(ev.employee.id) : '';
        if (!empId) continue;

        const start = toISODate(ev.start_date);
        const end = toISODate(ev.end_date || ev.start_date);
        if (!start || !end) continue;

        const cur = new Date(start + 'T00:00:00.000Z');
        const endDt = new Date(end + 'T00:00:00.000Z');
        if (Number.isNaN(cur.getTime()) || Number.isNaN(endDt.getTime())) continue;

        while (cur.getTime() <= endDt.getTime()) {
            const day = toISODate(cur);
            if (monthDaySet.has(day)) {
                if (!byEmp.has(empId)) byEmp.set(empId, new Map());
                // Prioridad: Baja > Permiso > Vacaciones
                const existing = byEmp.get(empId).get(day);
                const nextKind = ev.kind;
                const prio = k => (k === 'absence' ? 3 : (k === 'permission' ? 2 : (k === 'vacation' ? 1 : 0)));
                if (!existing || prio(nextKind) >= prio(existing.kind)) {
                    byEmp.get(empId).set(day, {
                        kind: nextKind,
                        status: ev.status,
                        subtype: ev.subtype,
                        reason: ev.reason
                    });
                }
            }
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
    }

    return byEmp;
}

let currentStore = '';
let currentMonth = '';
let currentEmployees = [];
let currentAssignments = {}; // employeeId -> { YYYY-MM-DD: code }
let currentEvents = [];

async function loadStoresIntoSelect() {
    const sel = document.getElementById('storeSelect');
    sel.innerHTML = '<option value="">Cargando…</option>';

    const data = await callAPI(`${API_URL}/quadrants/stores`);
    const user = (typeof getUser === 'function') ? getUser() : null;
    const isAdminUser = !!(user && user.role === 'admin');

    const unique = Array.from(new Set((data && data.stores ? data.stores : []).map(s => String(s).trim()).filter(Boolean)))
        .filter(s => isAdminUser ? true : !isFactoryName(s))
        .sort((a, b) => a.localeCompare(b, 'es'));

    sel.innerHTML = '<option value="">Selecciona…</option>' + unique.map(s => {
        const safe = s.replace(/"/g, '&quot;');
        return `<option value="${safe}">${safe}</option>`;
    }).join('');

    // Si viene por querystring, preseleccionamos
    const params = new URLSearchParams(window.location.search);
    const pre = (params.get('store') || '').trim();
    if (pre && unique.includes(pre)) {
        sel.value = pre;
    }
}

function setDefaultMonth() {
    const input = document.getElementById('monthInput');
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    input.value = `${y}-${m}`;
}

function renderSummary() {
    const el = document.getElementById('summaryText');
    if (!currentStore || !currentMonth) {
        el.textContent = 'Selecciona tienda y mes, y pulsa Cargar.';
        return;
    }

    const active = currentEmployees.filter(e => e.status === 'active').length;
    const onLeave = currentEmployees.filter(e => e.status === 'on_leave').length;

    const counts = { vacation: 0, permission: 0, absence: 0 };
    for (const ev of (currentEvents || [])) {
        if (ev.kind === 'vacation') counts.vacation++;
        else if (ev.kind === 'permission') counts.permission++;
        else if (ev.kind === 'absence') counts.absence++;
    }

    el.textContent = `${currentStore} · ${currentMonth} · Personal: ${active} activo, ${onLeave} en baja · Eventos: ${counts.vacation} vacaciones, ${counts.permission} permisos, ${counts.absence} bajas.`;
}

function renderEventsList() {
    const ul = document.getElementById('eventsList');
    ul.innerHTML = '';
    if (!currentEvents || currentEvents.length === 0) {
        ul.innerHTML = '<li>Sin eventos en el rango</li>';
        return;
    }

    const sorted = [...currentEvents].sort((a, b) => {
        const da = new Date(a.start_date).getTime();
        const db = new Date(b.start_date).getTime();
        return da - db;
    });

    for (const ev of sorted.slice(0, 80)) {
        const emp = ev.employee && ev.employee.full_name ? ev.employee.full_name : 'Empleado';
        const start = toISODate(ev.start_date);
        const end = toISODate(ev.end_date || ev.start_date);
        const label = eventLabel(ev.kind);
        const li = document.createElement('li');
        li.textContent = `${label} · ${emp} · ${start}${end && end !== start ? ' → ' + end : ''}`;
        ul.appendChild(li);
    }

    if (sorted.length > 80) {
        const li = document.createElement('li');
        li.textContent = `… y ${sorted.length - 80} más`;
        ul.appendChild(li);
    }
}

function renderTable(monthDays, eventsByEmpDay) {
    const thead = document.getElementById('quadrantHead');
    const tbody = document.getElementById('quadrantBody');

    // Header
    const headRow = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.className = 'quadrant-sticky-col quadrant-sticky-header';
    th0.textContent = 'Empleado';
    headRow.appendChild(th0);

    for (const day of monthDays) {
        const d = Number(day.slice(8, 10));
        const th = document.createElement('th');
        th.className = 'quadrant-sticky-header';
        th.textContent = String(d);
        headRow.appendChild(th);
    }

    thead.innerHTML = '';
    thead.appendChild(headRow);

    // Body
    tbody.innerHTML = '';

    if (!currentEmployees || currentEmployees.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = monthDays.length + 1;
        td.style.textAlign = 'center';
        td.style.padding = '2rem';
        td.style.color = 'var(--text-muted)';
        td.textContent = 'No hay empleados en esta tienda';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    for (const emp of currentEmployees) {
        const empId = String(emp.id || emp._id);
        const tr = document.createElement('tr');

        const nameTd = document.createElement('td');
        nameTd.className = 'quadrant-sticky-col';
        const statusTxt = emp.status === 'active' ? 'Activo' : (emp.status === 'on_leave' ? 'Baja' : emp.status);
        nameTd.innerHTML = `<div style="font-weight:600;">${(emp.full_name || '').replace(/</g, '&lt;')}</div>
            <div style="color: var(--text-muted); font-size: 0.8rem;">${(emp.position || '').replace(/</g, '&lt;')} · ${statusTxt}</div>`;
        tr.appendChild(nameTd);

        if (!currentAssignments[empId]) currentAssignments[empId] = {};

        for (const day of monthDays) {
            const td = document.createElement('td');

            const evInfo = eventsByEmpDay && eventsByEmpDay.get(empId) ? eventsByEmpDay.get(empId).get(day) : null;
            const lockedLabel = evInfo ? eventLabel(evInfo.kind) : '';

            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 16;
            input.className = 'quadrant-cell-input';
            input.dataset.empId = empId;
            input.dataset.day = day;

            const existing = currentAssignments[empId][day] || '';

            if (lockedLabel) {
                input.disabled = true;
                input.value = lockedLabel;
            } else {
                input.value = existing;
                input.addEventListener('input', () => {
                    const v = String(input.value || '').trim().slice(0, 16);
                    if (!currentAssignments[empId]) currentAssignments[empId] = {};
                    if (v) currentAssignments[empId][day] = v;
                    else delete currentAssignments[empId][day];
                });
            }

            td.appendChild(input);
            tr.appendChild(td);
        }

        tbody.appendChild(tr);
    }
}

async function loadQuadrant() {
    const store = (document.getElementById('storeSelect').value || '').trim();
    const month = (document.getElementById('monthInput').value || '').trim();

    if (!store) return showAlert('Selecciona una tienda', 'error');
    if (!/^\d{4}-\d{2}$/.test(month)) return showAlert('Selecciona un mes válido', 'error');

    currentStore = store;
    currentMonth = month;

    const monthDays = daysInMonth(month);
    const range = monthToRange(month);

    const [quad, eventsRes] = await Promise.all([
        callAPI(`${API_URL}/quadrants?location=${encodeURIComponent(store)}&month=${encodeURIComponent(month)}`),
        vacationsAPI.getTeamCalendar({
            start: toISODate(range.start),
            end: toISODate(range.end),
            location: store
        })
    ]);

    if (!quad) return;

    currentEmployees = (quad.employees || []).map(e => ({
        id: e.id || e._id,
        full_name: e.full_name,
        dni: e.dni,
        position: e.position,
        status: e.status,
        location: e.location
    }));

    currentAssignments = (quad.assignments && typeof quad.assignments === 'object') ? quad.assignments : {};

    currentEvents = (eventsRes && eventsRes.events) ? eventsRes.events : [];
    const eventsByEmpDay = buildEventDayMap(currentEvents, monthDays);

    renderSummary();
    renderEventsList();
    renderTable(monthDays, eventsByEmpDay);
}

async function saveQuadrant() {
    if (!currentStore || !currentMonth) return showAlert('Carga un cuadrante antes de guardar', 'error');

    const res = await callAPI(`${API_URL}/quadrants?location=${encodeURIComponent(currentStore)}&month=${encodeURIComponent(currentMonth)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ assignments: currentAssignments })
        }
    );

    if (!res) return;
    showAlert('Cuadrante guardado', 'success');
}

async function clearEditableCells() {
    const inputs = Array.from(document.querySelectorAll('.quadrant-cell-input'));
    for (const input of inputs) {
        if (input.disabled) continue;
        input.value = '';
        const empId = input.dataset.empId;
        const day = input.dataset.day;
        if (currentAssignments[empId]) {
            delete currentAssignments[empId][day];
        }
    }
    showAlert('Códigos editables limpiados (no afecta días bloqueados)', 'success');
}

async function exportQuadrantPdf() {
    if (!window.jspdf) return alert('Error: La librería PDF no está cargada.');
    if (!currentStore || !currentMonth) return showAlert('Carga un cuadrante antes de exportar', 'error');

    await reportsUtil.loadConfig();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const monthDays = daysInMonth(currentMonth);
    const eventsByEmpDay = buildEventDayMap(currentEvents, monthDays);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`CUADRANTE · ${currentStore} · ${currentMonth}`, 14, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Leyenda: V=Vacaciones, P=Permiso, B=Baja', 14, 20);

    const head = [['Empleado', ...monthDays.map(d => d.slice(8, 10))]];

    const body = currentEmployees.map(emp => {
        const empId = String(emp.id || emp._id);
        const statusTxt = emp.status === 'active' ? 'A' : (emp.status === 'on_leave' ? 'Baja' : emp.status);
        const row = [`${emp.full_name || ''} (${statusTxt})`];

        for (const day of monthDays) {
            const evInfo = eventsByEmpDay && eventsByEmpDay.get(empId) ? eventsByEmpDay.get(empId).get(day) : null;
            const lockedLabel = evInfo ? eventLabel(evInfo.kind) : '';
            if (lockedLabel) {
                row.push(lockedLabel);
            } else {
                row.push((currentAssignments[empId] && currentAssignments[empId][day]) ? String(currentAssignments[empId][day]) : '');
            }
        }
        return row;
    });

    doc.autoTable({
        head,
        body,
        startY: 24,
        styles: {
            font: 'helvetica',
            fontSize: 6,
            cellPadding: 1,
            overflow: 'linebreak'
        },
        headStyles: {
            fillColor: reportsUtil.config.secondaryColor || [30, 41, 59],
            textColor: [255, 255, 255]
        },
        columnStyles: {
            0: { cellWidth: 55 }
        },
        margin: { left: 10, right: 10 }
    });

    const safeStore = currentStore.replace(/[^\w\-.]+/g, '_');
    await reportsUtil.savePdf(doc, `Cuadrante_${safeStore}_${currentMonth}.pdf`);
}

async function init() {
    document.getElementById('btnLoad').addEventListener('click', loadQuadrant);
    document.getElementById('btnSave').addEventListener('click', saveQuadrant);
    document.getElementById('btnExport').addEventListener('click', exportQuadrantPdf);
    document.getElementById('btnClear').addEventListener('click', clearEditableCells);

    setDefaultMonth();
    await loadStoresIntoSelect();

    // Auto-carga si hay store
    const store = (document.getElementById('storeSelect').value || '').trim();
    if (store) {
        await loadQuadrant();
    }
}

document.addEventListener('DOMContentLoaded', init);
