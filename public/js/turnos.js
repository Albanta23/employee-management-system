/**
 * turnos.js — Panel de gestión de turnos (admin / store_coordinator)
 */

// ─── Réplica del motor de horas (funciones puras, sin dependencias) ───────────

function _timeToMins(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function _getSaturdays(year, month) {
    const sats = [];
    const last = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
        if (new Date(year, month, d).getDay() === 6) sats.push(d);
    }
    return sats;
}

function _buildCalendarDays(shift, year, month) {
    const last     = new Date(year, month + 1, 0).getDate();
    const sats     = _getSaturdays(year, month);
    const openDays = shift.openDays || [1,2,3,4,5];
    const satOff   = (shift.satWeeksOff || []).map(i => sats[i]).filter(Boolean);
    const satWork  = sats.filter(s => !satOff.includes(s) && openDays.includes(6));

    const days = [];
    for (let d = 1; d <= last; d++) {
        const dow = new Date(year, month, d).getDay();
        let type, start, end;

        if (dow === 0) {
            type = 'sunday';
        } else if (dow === 6) {
            if (satOff.includes(d))  { type = 'sat_off'; }
            else if (satWork.includes(d)) { type = 'sat_work'; start = shift.satStart; end = shift.satEnd; }
            else { type = 'sunday'; }
        } else {
            if (openDays.includes(dow)) { type = 'workday'; start = shift.weekdayStart; end = shift.weekdayEnd; }
            else { type = 'sunday'; }
        }

        days.push({ day: d, dow, type, start: start || null, end: end || null });
    }
    return days;
}

function _calcShiftHours(shift, year, month) {
    const last     = new Date(year, month + 1, 0).getDate();
    const sats     = _getSaturdays(year, month);
    const openDays = shift.openDays || [1,2,3,4,5];
    const satOff   = (shift.satWeeksOff || []).map(i => sats[i]).filter(Boolean);
    const satWork  = sats.filter(s => !satOff.includes(s) && openDays.includes(6));

    let weekdayCount = 0;
    for (let d = 1; d <= last; d++) {
        const dow = new Date(year, month, d).getDay();
        if (dow !== 0 && dow !== 6 && openDays.includes(dow)) weekdayCount++;
    }

    const weekdayMins = _timeToMins(shift.weekdayEnd) - _timeToMins(shift.weekdayStart);
    const satMins     = openDays.includes(6) && shift.satStart && shift.satEnd
        ? _timeToMins(shift.satEnd) - _timeToMins(shift.satStart) : 0;

    const scheduledMins = weekdayCount * weekdayMins + satWork.length * satMins;
    const weeksInMonth  = weekdayCount / 5;
    const targetMins    = Math.round((shift.targetHoursWeek || 40) * 60 * weeksInMonth);

    return {
        scheduledMins, targetMins,
        balanceMins: scheduledMins - targetMins,
        weekdayCount, satWorked: satWork.length, satOff: satOff.length,
        weekdayMins, satMins,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DOW_LABELS = ['D','L','M','X','J','V','S'];

function fmtHours(mins) {
    const h = Math.floor(Math.abs(mins) / 60);
    const m = Math.abs(mins) % 60;
    const sign = mins < 0 ? '−' : '';
    return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}min`;
}

function showAlert(msg, type = 'success') {
    const container = document.getElementById('alert-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiGet(path) {
    try {
        const res = await fetch(`${API_URL}${path}`, { headers: getAuthHeaders() });
        if (res.status === 401) { logout(); return null; }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showAlert(err.error || 'Error de servidor', 'error');
            return null;
        }
        return res.json();
    } catch (e) { showAlert('Error de conexión', 'error'); return null; }
}

async function apiPost(path, body) {
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body)
        });
        if (res.status === 401) { logout(); return null; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showAlert(data.error || 'Error de servidor', 'error'); return null; }
        return data;
    } catch (e) { showAlert('Error de conexión', 'error'); return null; }
}

async function apiPut(path, body) {
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body)
        });
        if (res.status === 401) { logout(); return null; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showAlert(data.error || 'Error de servidor', 'error'); return null; }
        return data;
    } catch (e) { showAlert('Error de conexión', 'error'); return null; }
}

async function apiDelete(path) {
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (res.status === 401) { logout(); return null; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showAlert(data.error || 'Error de servidor', 'error'); return null; }
        return data;
    } catch (e) { showAlert('Error de conexión', 'error'); return null; }
}

// ─── Estado de la app ─────────────────────────────────────────────────────────

const turnosApp = (() => {

    let allShifts    = [];
    let currentShift = null;
    let allEmployees = [];
    let calYear      = new Date().getFullYear();
    let calMonth     = new Date().getMonth();
    let assignAbsData = {}; // { empId: { absenceDays, vacationDays, totalAbsenceDays } }
    let rotYear      = new Date().getFullYear();
    let rotMonth     = new Date().getMonth();

    // ── Setup tabs ────────────────────────────────────────────────────────────

    function setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
                onTabActivated(btn.dataset.tab);
            });
        });
    }

    function onTabActivated(tab) {
        if (!currentShift) return;
        switch (tab) {
            case 'calendar':   loadCalendar(); break;
            case 'personal':   loadEmployees(); break;
            case 'hours':      loadHours(); break;
            case 'simulation': loadSimulation(); break;
            case 'publish':    loadPublishTab(); break;
            case 'rotation':   loadRotationTab(); break;
        }
    }

    function getActiveTab() {
        const btn = document.querySelector('.tab-btn.active');
        return btn ? btn.dataset.tab : 'calendar';
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    async function init() {
        setupTabs();

        // Cargar tiendas desde la API
        const stores = await apiGet('/shifts/stores');
        if (!stores) return;

        const locSel = document.getElementById('locationSelect');
        locSel.innerHTML = stores.map(s =>
            `<option value="${s}">${s}</option>`
        ).join('');

        // Modal store select
        document.getElementById('sStoreName').innerHTML = stores.map(s =>
            `<option value="${s}">${s}</option>`
        ).join('');

        // Sábado checkbox toggle
        document.getElementById('chkSatOpen').addEventListener('change', function() {
            document.getElementById('satBlock').style.display = this.checked ? 'block' : 'none';
        });

        // Form submit
        document.getElementById('shiftForm').addEventListener('submit', onShiftFormSubmit);

        // Cargar empleados para asignación (solo una vez)
        const emps = await apiGet('/employees');
        if (emps) allEmployees = Array.isArray(emps.employees) ? emps.employees : (Array.isArray(emps) ? emps : []);

        if (stores.length > 0) {
            await onLocationChange();
        }

        // Mes por defecto en publicación
        const now = new Date();
        document.getElementById('publishMonth').value =
            `${now.getFullYear()}-${String(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2).padStart(2,'0')}`;
    }

    // ── Location / shift change ───────────────────────────────────────────────

    async function onLocationChange() {
        const storeName = document.getElementById('locationSelect').value;
        const shifts = await apiGet(`/shifts?store_name=${encodeURIComponent(storeName)}&active=true`);
        if (!shifts) return;
        allShifts = shifts;

        const sel = document.getElementById('shiftSelect');
        sel.innerHTML = '<option value="">— Selecciona turno —</option>' +
            shifts.map(s => `<option value="${s._id}">${s.name}</option>`).join('');

        currentShift = null;
        showShiftUI(false);
    }

    async function onShiftChange() {
        const id = document.getElementById('shiftSelect').value;
        if (!id) { currentShift = null; showShiftUI(false); return; }

        const shift = await apiGet(`/shifts/${id}`);
        if (!shift) return;
        currentShift = shift;
        showShiftUI(true);
        document.getElementById('btnEditShift').style.display = '';
        document.getElementById('btnDeleteShift').style.display = '';

        // Activar el tab visible
        onTabActivated(getActiveTab());
    }

    function showShiftUI(visible) {
        document.getElementById('tabs-card').style.display           = visible ? '' : 'none';
        document.getElementById('noShiftPlaceholder').style.display  = visible ? 'none' : '';
        document.getElementById('btnEditShift').style.display        = visible ? '' : 'none';
        document.getElementById('btnDeleteShift').style.display      = visible ? '' : 'none';
    }

    // ── Tab 1: Calendario ─────────────────────────────────────────────────────

    async function loadCalendar() {
        document.getElementById('calMonthLabel').textContent =
            `${MONTHS_ES[calMonth]} ${calYear}`;

        const data = await apiGet(`/shifts/${currentShift._id}/calendar?month=${calMonth}&year=${calYear}`);
        renderCalendar(data ? data.days : _buildCalendarDays(currentShift, calYear, calMonth),
                       data ? (data.days.reduce((m,d) => { m[d.day] = d.absentCount; return m; }, {})) : {});
    }

    function renderCalendar(days, absentByDay = {}) {
        const grid = document.getElementById('calGrid');
        const today = new Date();

        // Cabecera: L M X J V S D
        const headers = ['L','M','X','J','V','S','D'];
        let html = headers.map(h => `<div class="cal-header-cell">${h}</div>`).join('');

        // Primer día del mes (0=Dom → ajustamos a Lunes=0)
        const firstDow = new Date(calYear, calMonth, 1).getDay(); // 0=Dom
        const offset   = firstDow === 0 ? 6 : firstDow - 1;
        for (let i = 0; i < offset; i++) html += '<div class="cal-cell empty"></div>';

        days.forEach(d => {
            const isToday = today.getFullYear() === calYear &&
                            today.getMonth()    === calMonth &&
                            today.getDate()     === d.day;

            const absCount = absentByDay[d.day] || d.absentCount || 0;

            let chipHtml = '';
            if (d.type === 'workday') {
                chipHtml = `<div class="cal-chip cal-chip-work">${d.start}–${d.end}</div>`;
            } else if (d.type === 'sat_work') {
                chipHtml = `<div class="cal-chip cal-chip-sat">${d.start}–${d.end}</div>`;
            } else if (d.type === 'sat_off') {
                chipHtml = `<div class="cal-chip cal-chip-free">Libre</div>`;
            }

            if (absCount > 0) {
                chipHtml += `<div class="cal-chip cal-chip-absent">${absCount} aus.</div>`;
            }

            const classes = ['cal-cell', d.type === 'sunday' ? 'sunday' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
            html += `<div class="${classes}"><div class="cal-day-num">${d.day}</div>${chipHtml}</div>`;
        });

        grid.innerHTML = html;
    }

    function prevMonth() {
        calMonth--;
        if (calMonth < 0) { calMonth = 11; calYear--; }
        loadCalendar();
    }

    function nextMonth() {
        calMonth++;
        if (calMonth > 11) { calMonth = 0; calYear++; }
        loadCalendar();
    }

    // ── Tab 2: Personal ───────────────────────────────────────────────────────

    async function loadEmployees() {
        document.getElementById('personalTitle').textContent =
            `Empleados del turno — ${currentShift.name}`;

        const [emps, simData] = await Promise.all([
            apiGet(`/shifts/${currentShift._id}/employees`),
            apiGet(`/shifts/${currentShift._id}/absence-sim?month=${calMonth}&year=${calYear}`)
        ]);

        const tbody = document.getElementById('employeesBody');

        if (!emps || emps.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="no-data">
                <div class="no-data-icon">👤</div>Ningún empleado asignado a este turno
            </td></tr>`;
            return;
        }

        // Construir mapa de ausencias por empleado
        const absMap = {};
        if (simData && simData.employees) {
            simData.employees.forEach(e => {
                absMap[String(e.employee._id)] = e;
            });
        }

        const statusMap = { active: 'badge-active', on_leave: 'badge-on_leave', inactive: 'badge-inactive' };
        const statusLabel = { active: 'Activo', on_leave: 'Baja', inactive: 'Inactivo' };

        tbody.innerHTML = emps.map(emp => {
            const absInfo = absMap[String(emp._id)];
            let absBadges = '';
            if (absInfo) {
                if (absInfo.vacationDays > 0) {
                    absBadges += `<span style="font-size:0.68rem; background:rgba(99,102,241,0.2); color:#a5b4fc;
                        border-radius:4px; padding:1px 5px; margin-left:4px; white-space:nowrap;">🏖️ ${absInfo.vacationDays}d</span>`;
                }
                if (absInfo.absenceDays > 0) {
                    absBadges += `<span style="font-size:0.68rem; background:rgba(239,68,68,0.15); color:#fca5a5;
                        border-radius:4px; padding:1px 5px; margin-left:4px; white-space:nowrap;">🏥 ${absInfo.absenceDays}d</span>`;
                }
            }
            const rotatBadge = emp.can_rotate
                ? `<span style="font-size:0.68rem; background:rgba(234,88,12,0.2); color:#fb923c;
                    border-radius:4px; padding:1px 5px; margin-left:4px; white-space:nowrap;">🔄 Rotativo</span>`
                : '';
            return `
            <tr>
                <td><strong>${emp.full_name}</strong>${absBadges}${rotatBadge}</td>
                <td style="color:var(--text-muted);">${emp.position || '—'}</td>
                <td>
                    <span class="emp-status-badge ${statusMap[emp.status] || ''}">${statusLabel[emp.status] || emp.status}</span>
                </td>
                <td style="text-align:right; display:flex; gap:4px; justify-content:flex-end;">
                    <button class="btn btn-secondary" style="font-size:0.78rem; padding:4px 10px;"
                        onclick="turnosApp.toggleRotativo('${emp._id}', ${!!emp.can_rotate}, '${emp.full_name.replace(/'/g, "\\'")}')">
                        ${emp.can_rotate ? '🔄 Quitar rotativo' : '🔄 Marcar rotativo'}
                    </button>
                    <button class="btn btn-secondary" style="font-size:0.78rem; padding:4px 10px; color:#f87171;"
                        onclick="turnosApp.unassignEmployee('${emp._id}', '${emp.full_name.replace(/'/g, "\\'")}')">
                        Desasignar
                    </button>
                </td>
            </tr>
        `}).join('');
    }

    async function unassignEmployee(empId, name) {
        if (!confirm(`¿Desasignar a ${name} del turno ${currentShift.name}?`)) return;
        const res = await apiDelete(`/shifts/${currentShift._id}/employees/${empId}`);
        if (res) { showAlert(`${name} desasignado`, 'success'); loadEmployees(); }
    }

    async function openAssignModal() {
        document.getElementById('assignSearch').value = '';
        assignAbsData = {};
        document.getElementById('assignModal').classList.add('active');
        filterAssignList(); // render inmediato sin datos de ausencias

        // Cargar ausencias/vacaciones del mes en curso para mostrar advertencias
        try {
            const data = await apiGet(`/shifts/${currentShift._id}/absence-sim?month=${calMonth}&year=${calYear}`);
            if (data && data.employees) {
                assignAbsData = {};
                data.employees.forEach(e => {
                    assignAbsData[String(e.employee._id)] = e;
                });
                filterAssignList(); // re-renderizar con datos de ausencias
            }
        } catch (e) {}
    }

    function closeAssignModal() {
        document.getElementById('assignModal').classList.remove('active');
    }

    function filterAssignList() {
        const q = document.getElementById('assignSearch').value.toLowerCase();
        // Filtrar solo empleados de la misma tienda/localización que el turno
        const shiftStore = (currentShift.store_name || '').trim().toLowerCase();
        const filtered = allEmployees.filter(e =>
            e.status !== 'inactive' &&
            (e.location || '').trim().toLowerCase() === shiftStore &&
            (e.full_name.toLowerCase().includes(q) || (e.position || '').toLowerCase().includes(q))
        );

        const list = document.getElementById('assignList');
        if (filtered.length === 0) {
            list.innerHTML = `<div style="color:var(--text-muted); font-size:0.875rem; text-align:center; padding:1rem;">
                Sin empleados en <strong>${currentShift.store_name || 'esta tienda'}</strong></div>`;
            return;
        }

        list.innerHTML = filtered.map(emp => {
            const alreadyInShift = emp.shift_id && String(emp.shift_id) === String(currentShift._id);
            const inOtherShift   = emp.shift_id && !alreadyInShift;

            // Badges de ausencias/vacaciones del mes
            const absInfo = assignAbsData[String(emp._id)];
            let absBadges = '';
            if (absInfo) {
                if (absInfo.vacationDays > 0) {
                    absBadges += `<span style="font-size:0.68rem; background:rgba(99,102,241,0.2); color:#a5b4fc;
                        border-radius:4px; padding:1px 5px; white-space:nowrap;">🏖️ ${absInfo.vacationDays}d vac.</span>`;
                }
                if (absInfo.absenceDays > 0) {
                    absBadges += `<span style="font-size:0.68rem; background:rgba(239,68,68,0.15); color:#fca5a5;
                        border-radius:4px; padding:1px 5px; white-space:nowrap;">🏥 ${absInfo.absenceDays}d baja</span>`;
                }
            }

            let actionHtml;
            if (alreadyInShift) {
                actionHtml = '<span style="font-size:0.75rem; color:#4ade80; white-space:nowrap;">✓ En este turno</span>';
            } else if (inOtherShift) {
                actionHtml = `<button class="btn btn-secondary" style="font-size:0.78rem; padding:4px 10px; color:#fbbf24; white-space:nowrap; border-color:rgba(245,158,11,0.3);"
                    onclick="turnosApp.reassignEmployee('${emp._id}', '${emp.full_name.replace(/'/g, "\\'")}')">⚠️ Reasignar</button>`;
            } else {
                actionHtml = `<button class="btn btn-secondary" style="font-size:0.78rem; padding:4px 10px; white-space:nowrap;"
                    onclick="turnosApp.assignEmployee('${emp._id}')">Asignar</button>`;
            }

            const borderColor = inOtherShift ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.05)';

            return `
                <div style="display:flex; align-items:center; justify-content:space-between;
                    padding:0.6rem 0.75rem; background:rgba(30,41,59,0.5);
                    border-radius:var(--radius-md); border:1px solid ${borderColor}; gap:0.5rem;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:500; font-size:0.875rem;">${emp.full_name}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${emp.position || ''} · ${emp.location || ''}</div>
                        ${absBadges ? `<div style="display:flex; gap:0.3rem; flex-wrap:wrap; margin-top:3px;">${absBadges}</div>` : ''}
                    </div>
                    ${actionHtml}
                </div>
            `;
        }).join('');
    }

    async function assignEmployee(empId) {
        const res = await apiPost(`/shifts/${currentShift._id}/assign-employee`, { employee_id: empId });
        if (res) {
            showAlert('Empleado asignado y notificado', 'success');
            // Reload employee list
            const emps = await apiGet('/employees');
            if (emps) allEmployees = Array.isArray(emps.employees) ? emps.employees : (Array.isArray(emps) ? emps : []);
            filterAssignList();
            loadEmployees();
        }
    }

    async function reassignEmployee(empId, name) {
        if (!confirm(`⚠️ ${name} ya está asignado a otro turno.\n\n¿Deseas reasignarlo al turno "${currentShift.name}"?\nSe le desasignará del turno actual automáticamente.`)) return;
        await assignEmployee(empId);
    }

    // ── Tab 3: Horas y Balance ────────────────────────────────────────────────

    async function loadHours() {
        const data = await apiGet(`/shifts/${currentShift._id}/hours?month=${calMonth}&year=${calYear}`);
        if (!data) return;

        const h = data.hours;
        const s = data.suggestion;
        const scheduled = (h.scheduledMins / 60).toFixed(1);
        const target    = (h.targetMins    / 60).toFixed(1);
        const balance   = h.balanceMins;
        const balanceClass = balance > 5 ? 'stat-positive' : balance < -5 ? 'stat-negative' : 'stat-positive';

        document.getElementById('hoursStats').innerHTML = `
            <div class="stat-card">
                <div class="stat-label">Horas programadas</div>
                <div class="stat-value stat-neutral">${scheduled}h</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Objetivo del mes</div>
                <div class="stat-value stat-neutral">${target}h</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Balance</div>
                <div class="stat-value ${balanceClass}">${balance >= 0 ? '+' : ''}${fmtHours(balance)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Objetivo semanal</div>
                <div class="stat-value stat-neutral">${data.shift.targetHoursWeek}h/sem</div>
            </div>
        `;

        // Barra de balance
        const pct = Math.min(100, Math.round((h.scheduledMins / Math.max(h.targetMins, 1)) * 100));
        const barColor = balance > 5 ? '#4ade80' : balance < -5 ? '#f87171' : '#4ade80';

        let detailHtml = `
            <div style="background:rgba(30,41,59,0.4); border:1px solid rgba(255,255,255,0.06);
                border-radius:var(--radius-lg); padding:var(--spacing-lg); margin-bottom:var(--spacing-md);">
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:var(--spacing-md);
                    margin-bottom:var(--spacing-md); text-align:center;">
                    <div><div style="color:var(--text-muted); font-size:0.78rem;">Días L–V</div>
                         <div style="font-size:1.2rem; font-weight:600;">${h.weekdayCount}</div></div>
                    <div><div style="color:var(--text-muted); font-size:0.78rem;">Sáb. trabajados</div>
                         <div style="font-size:1.2rem; font-weight:600;">${h.satWorked}</div></div>
                    <div><div style="color:var(--text-muted); font-size:0.78rem;">Sáb. libres</div>
                         <div style="font-size:1.2rem; font-weight:600;">${h.satOff}</div></div>
                </div>
                <div class="balance-bar-wrap">
                    <div style="display:flex; justify-content:space-between; font-size:0.78rem;
                        color:var(--text-muted); margin-bottom:4px;">
                        <span>0h</span><span>${target}h objetivo</span>
                    </div>
                    <div class="balance-bar-bg">
                        <div class="balance-bar-fill" style="width:${pct}%; background:${barColor};"></div>
                    </div>
                    <div style="text-align:right; font-size:0.78rem; color:var(--text-muted); margin-top:4px;">${pct}%</div>
                </div>
            </div>
        `;

        if (s) {
            detailHtml += `
                <div style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.25);
                    border-radius:var(--radius-lg); padding:var(--spacing-md);">
                    <strong style="color:#fbbf24;">💡 Sugerencia de ajuste</strong>
                    <p style="margin:0.5rem 0 0; font-size:0.875rem; color:var(--text-secondary);">
                        Desviation de ${fmtHours(Math.abs(s.balanceMins))}. Cambia la salida L–V de
                        <strong>${data.shift.weekdayEnd}</strong> a
                        <strong>${s.suggestedWeekdayEnd}</strong>
                        (${s.minsPerDay >= 0 ? '+' : ''}${s.minsPerDay} min/día) para cuadrar exactamente ${s.targetHours}h.
                    </p>
                </div>
            `;
        }

        document.getElementById('hoursDetail').innerHTML = detailHtml;
    }

    // ── Tab 4: Simulador ──────────────────────────────────────────────────────

    async function loadSimulation() {
        const data = await apiGet(`/shifts/${currentShift._id}/absence-sim?month=${calMonth}&year=${calYear}`);
        if (!data) return;

        const { summary, employees } = data;

        const summaryCard = document.getElementById('simSummaryCard');
        summaryCard.style.display = '';
        summaryCard.outerHTML = `
            <div id="simSummaryCard" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
                gap:var(--spacing-md); margin-bottom:var(--spacing-lg);">
                <div class="stat-card">
                    <div class="stat-label">Trabajadores</div>
                    <div class="stat-value stat-neutral">${summary.totalEmployees}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Con ausencias</div>
                    <div class="stat-value ${summary.totalAbsent > 0 ? 'stat-negative' : 'stat-positive'}">${summary.totalAbsent}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Horas perdidas</div>
                    <div class="stat-value ${summary.totalHoursLost > 0 ? 'stat-negative' : 'stat-positive'}">${summary.totalHoursLost}h</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cobertura</div>
                    <div class="stat-value ${summary.coverage < 80 ? 'stat-negative' : 'stat-positive'}">${summary.coverage}%</div>
                </div>
            </div>
        `;

        const grid = document.getElementById('simGrid');
        if (!employees || employees.length === 0) {
            grid.innerHTML = '<div class="no-data"><div class="no-data-icon">✅</div>Sin empleados asignados</div>';
            return;
        }

        grid.innerHTML = employees.map(e => `
            <div class="sim-card ${e.absent ? 'has-absence' : ''}">
                <div style="font-weight:600; margin-bottom:0.5rem;">${e.employee.full_name}</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; font-size:0.8rem; color:var(--text-muted);">
                    <div>Días baja: <strong style="color:var(--text-primary);">${e.absenceDays}</strong></div>
                    <div>Días vacac.: <strong style="color:var(--text-primary);">${e.vacationDays}</strong></div>
                    <div>Horas perdidas: <strong style="${e.hoursLost > 0 ? 'color:#f87171' : ''}">${e.hoursLost}h</strong></div>
                    <div>H. efectivas: <strong style="color:var(--text-primary);">${e.effectiveHours}h</strong></div>
                </div>
            </div>
        `).join('');
    }

    // ── Tab 5: Publicar ───────────────────────────────────────────────────────

    async function loadPublishTab() {
        renderPublishPreview();
        loadPublicationHistory();
    }

    function renderPublishPreview() {
        if (!currentShift) return;
        const monthVal = document.getElementById('publishMonth').value;
        if (!monthVal) return;

        const [y, m] = monthVal.split('-').map(Number);
        const month  = m - 1;
        const h      = _calcShiftHours(currentShift, y, month);

        const sats = _getSaturdays(y, month);
        const satOff = (currentShift.satWeeksOff || []).map(i => sats[i]).filter(Boolean);

        document.getElementById('publishPreview').innerHTML = `
            <div style="color:var(--text-primary); font-weight:600; margin-bottom:0.5rem;">
                ${currentShift.name} — ${MONTHS_ES[month]} ${y}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.35rem; font-size:0.8rem;">
                <div>L–V: <strong>${currentShift.weekdayStart}–${currentShift.weekdayEnd}</strong></div>
                ${currentShift.openDays && currentShift.openDays.includes(6)
                    ? `<div>Sáb: <strong>${currentShift.satStart}–${currentShift.satEnd}</strong></div>` : '<div></div>'}
                <div>Días trabajados: <strong>${h.weekdayCount + h.satWorked}</strong></div>
                <div>Sáb. libres: <strong>${satOff.length > 0 ? satOff.join(', ') : '—'}</strong></div>
                <div>Programado: <strong>${(h.scheduledMins/60).toFixed(1)}h</strong></div>
                <div>Balance: <strong style="color:${h.balanceMins>=0?'#4ade80':'#f87171'};">
                    ${h.balanceMins>=0?'+':''}${fmtHours(h.balanceMins)}</strong></div>
            </div>
        `;
    }

    async function loadPublicationHistory() {
        const pubs = await apiGet(`/shifts/${currentShift._id}/publications`);
        const container = document.getElementById('publicationHistory');

        if (!pubs || pubs.length === 0) {
            container.innerHTML = '<div class="no-data"><div class="no-data-icon">📋</div>Sin publicaciones aún</div>';
            return;
        }

        container.innerHTML = pubs.map(p => {
            const date = new Date(p.sent_at).toLocaleDateString('es-ES', { day:'numeric', month:'short', year:'numeric' });
            const who  = p.sent_by ? (p.sent_by.name || p.sent_by.username) : '—';
            return `
                <div class="pub-item">
                    <div style="font-size:1.5rem;">📣</div>
                    <div style="flex:1;">
                        <div style="font-weight:500; font-size:0.875rem;">${MONTHS_ES[p.month]} ${p.year}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">
                            ${date} · por ${who} · ${p.total_notified} notificados
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function publishSchedule() {
        const monthVal = document.getElementById('publishMonth').value;
        if (!monthVal) { showAlert('Selecciona un mes', 'warning'); return; }
        const [y, m] = monthVal.split('-').map(Number);

        if (!confirm(`¿Publicar el horario de ${MONTHS_ES[m-1]} ${y} para el turno ${currentShift.name}?`)) return;

        const res = await apiPost(`/shifts/${currentShift._id}/publish`, { month: m - 1, year: y });
        if (res) {
            showAlert(`Horario publicado — ${res.employeesNotified} empleado(s) notificado(s)`, 'success');
            loadPublicationHistory();
        }
    }

    // ── Modal Shift ───────────────────────────────────────────────────────────

    function openShiftModal(isEdit = false) {
        const modal = document.getElementById('shiftModal');
        document.getElementById('shiftModalTitle').textContent = isEdit ? 'Editar Turno' : 'Nuevo Turno';

        if (isEdit && currentShift) {
            const s = currentShift;
            document.getElementById('shiftId').value      = s._id;
            document.getElementById('sName').value        = s.name;
            document.getElementById('sColor').value       = s.color || '#6366f1';
            document.getElementById('sStoreName').value   = s.store_name || '';
            document.getElementById('sWeekStart').value   = s.weekdayStart;
            document.getElementById('sWeekEnd').value     = s.weekdayEnd;
            document.getElementById('sTargetHours').value = s.targetHoursWeek || 40;
            document.getElementById('sWorkers').value     = s.workersPerShift || 1;
            document.getElementById('sMinWorkers').value  = s.min_workers || 1;
            document.getElementById('sSatStart').value    = s.satStart || '';
            document.getElementById('sSatEnd').value      = s.satEnd || '';

            // Open days
            document.querySelectorAll('#openDaysChecks input[type=checkbox]').forEach(cb => {
                cb.checked = (s.openDays || [1,2,3,4,5]).includes(Number(cb.value));
            });

            // Sábados
            const hasSat = (s.openDays || []).includes(6);
            document.getElementById('chkSatOpen').checked = hasSat;
            document.getElementById('satBlock').style.display = hasSat ? 'block' : 'none';

            document.querySelectorAll('#satWeeksOffChecks input[type=checkbox]').forEach(cb => {
                cb.checked = (s.satWeeksOff || []).includes(Number(cb.value));
            });
        } else {
            document.getElementById('shiftForm').reset();
            document.getElementById('shiftId').value = '';
            document.getElementById('sColor').value  = '#6366f1';
            document.getElementById('sWeekStart').value = '08:00';
            document.getElementById('sWeekEnd').value   = '16:00';
            document.getElementById('sTargetHours').value = '40';
            document.getElementById('sWorkers').value     = '1';
            document.getElementById('sMinWorkers').value  = '1';
            document.getElementById('satBlock').style.display = 'none';
            document.querySelectorAll('#openDaysChecks input[type=checkbox]').forEach(cb => {
                cb.checked = [1,2,3,4,5].includes(Number(cb.value));
            });
            // Pre-select current tienda
            const storeName = document.getElementById('locationSelect').value;
            if (storeName) document.getElementById('sStoreName').value = storeName;
        }

        modal.classList.add('active');
    }

    function closeShiftModal() {
        document.getElementById('shiftModal').classList.remove('active');
    }

    async function onShiftFormSubmit(e) {
        e.preventDefault();

        const id = document.getElementById('shiftId').value;
        const openDays = Array.from(document.querySelectorAll('#openDaysChecks input:checked'))
            .map(cb => Number(cb.value));
        const satWeeksOff = Array.from(document.querySelectorAll('#satWeeksOffChecks input:checked'))
            .map(cb => Number(cb.value));

        const body = {
            name:            document.getElementById('sName').value.trim(),
            color:           document.getElementById('sColor').value,
            store_name:      document.getElementById('sStoreName').value,
            weekdayStart:    document.getElementById('sWeekStart').value,
            weekdayEnd:      document.getElementById('sWeekEnd').value,
            satStart:        document.getElementById('sSatStart').value,
            satEnd:          document.getElementById('sSatEnd').value,
            satWeeksOff,
            openDays,
            targetHoursWeek: Number(document.getElementById('sTargetHours').value),
            workersPerShift:  Number(document.getElementById('sWorkers').value),
            min_workers:      Number(document.getElementById('sMinWorkers').value) || 1,
        };

        let res;
        if (id) {
            res = await apiPut(`/shifts/${id}`, body);
        } else {
            res = await apiPost('/shifts', body);
        }

        if (!res) return;

        closeShiftModal();
        showAlert(id ? 'Turno actualizado' : 'Turno creado', 'success');

        // Recargar lista de turnos
        await onLocationChange();

        // Reseleccionar el turno
        const sel = document.getElementById('shiftSelect');
        sel.value = res._id || id;
        await onShiftChange();
    }

    async function deleteShift() {
        if (!currentShift) return;
        if (!confirm(`¿Eliminar el turno "${currentShift.name}"? Esta acción desasignará a todos sus empleados.`)) return;
        const res = await apiDelete(`/shifts/${currentShift._id}`);
        if (res) {
            showAlert('Turno eliminado', 'success');
            currentShift = null;
            await onLocationChange();
        }
    }

    // ── Rotativos ─────────────────────────────────────────────────────────────

    async function toggleRotativo(empId, isRotativo, name) {
        if (isRotativo) {
            if (!confirm(`¿Quitar la condición de rotativo a ${name}?`)) return;
            const res = await apiPut(`/employees/${empId}`, { can_rotate: false, secondary_shift_id: null });
            if (res) { showAlert(`${name} ya no es rotativo`, 'success'); loadEmployees(); }
            return;
        }
        // Abrir modal para elegir turno secundario
        document.getElementById('rotativoEmpId').value = empId;
        // Cargar turnos de la misma tienda (excluyendo el actual)
        const shifts = await apiGet(`/shifts?store_name=${encodeURIComponent(currentShift.store_name)}&active=true`);
        const sel = document.getElementById('rotativoSecondaryShift');
        sel.innerHTML = (shifts || [])
            .filter(s => String(s._id) !== String(currentShift._id))
            .map(s => `<option value="${s._id}">${s.name} (${s.weekdayStart}–${s.weekdayEnd})</option>`)
            .join('');
        if (!sel.innerHTML) {
            sel.innerHTML = '<option value="">No hay otros turnos en esta tienda</option>';
        }
        document.getElementById('rotativoModal').classList.add('active');
    }

    function closeRotativoModal() {
        document.getElementById('rotativoModal').classList.remove('active');
    }

    async function confirmMarkRotativo() {
        const empId = document.getElementById('rotativoEmpId').value;
        const secShiftId = document.getElementById('rotativoSecondaryShift').value;
        if (!secShiftId) { showAlert('Selecciona un turno secundario', 'warning'); return; }
        const res = await apiPut(`/employees/${empId}`, { can_rotate: true, secondary_shift_id: secShiftId });
        if (res) {
            showAlert('Empleado marcado como rotativo', 'success');
            closeRotativoModal();
            loadEmployees();
        }
    }

    // ── Rotación tab ──────────────────────────────────────────────────────────

    function rotPrevMonth() {
        rotMonth--;
        if (rotMonth < 0) { rotMonth = 11; rotYear--; }
        loadRotationTab();
    }

    function rotNextMonth() {
        rotMonth++;
        if (rotMonth > 11) { rotMonth = 0; rotYear++; }
        loadRotationTab();
    }

    /** Devuelve las semanas del mes: array de {weekStart, weekEnd, label} */
    function getMonthWeeks(year, month) {
        const weeks = [];
        const firstDay = new Date(Date.UTC(year, month, 1));
        const lastDay  = new Date(Date.UTC(year, month + 1, 0));

        // Ir al lunes de la primera semana
        let cur = new Date(firstDay);
        const dow = cur.getUTCDay();
        const diff = (dow === 0) ? -6 : 1 - dow;
        cur.setUTCDate(cur.getUTCDate() + diff);

        while (cur <= lastDay) {
            const wStart = new Date(cur);
            const wEnd   = new Date(cur);
            wEnd.setUTCDate(wEnd.getUTCDate() + 6);
            wEnd.setUTCHours(23, 59, 59, 999);

            const startStr = wStart.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
            const endStr   = new Date(Math.min(wEnd, lastDay)).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
            weeks.push({ weekStart: wStart, weekEnd: wEnd, label: `${startStr} – ${endStr}` });
            cur.setUTCDate(cur.getUTCDate() + 7);
        }
        return weeks;
    }

    async function loadRotationTab() {
        if (!currentShift) return;

        const lbl = document.getElementById('rotMonthLabel');
        if (lbl) lbl.textContent = `${MONTHS_ES[rotMonth]} ${rotYear}`;

        const wrap = document.getElementById('rotationTableWrap');
        if (!wrap) return;
        wrap.innerHTML = '<div style="color:var(--text-muted); padding:1rem;">Cargando...</div>';

        // 1. Empleados rotativos de este turno
        const emps = await apiGet(`/shifts/${currentShift._id}/employees`);
        const rotators = (emps || []).filter(e => e.can_rotate);

        if (rotators.length === 0) {
            wrap.innerHTML = `<div class="no-data" style="padding:2rem;">
                <div class="no-data-icon">🔄</div>
                Ningún empleado del turno tiene habilitada la rotación.<br>
                <small style="color:var(--text-muted);">Ve a la pestaña Personal y marca empleados como rotativos.</small>
            </div>`;
            return;
        }

        // 2. Plan de rotación del mes
        const plans = await apiGet(`/shifts/rotation-plan?month=${rotMonth}&year=${rotYear}&store_name=${encodeURIComponent(currentShift.store_name)}`);

        // 3. Semanas del mes
        const weeks = getMonthWeeks(rotYear, rotMonth);

        // 4. Turnos disponibles en la tienda (para mostrar nombres)
        const shiftsInStore = await apiGet(`/shifts?store_name=${encodeURIComponent(currentShift.store_name)}&active=true`);

        renderRotationTable(rotators, plans || [], weeks, shiftsInStore || []);
    }

    function renderRotationTable(rotators, plans, weeks, allShifts) {
        const wrap = document.getElementById('rotationTableWrap');
        if (!wrap) return;

        // Construir mapa de planes: "empId_weekStart" -> plan
        const planMap = {};
        plans.forEach(p => {
            const empId = typeof p.employee_id === 'object' ? String(p.employee_id._id || p.employee_id) : String(p.employee_id);
            const key   = `${empId}_${new Date(p.week_start).toISOString().split('T')[0]}`;
            planMap[key] = p;
        });

        // Buscar turno secundario de cada rotativo
        function getSecondaryShiftName(emp) {
            const secId = typeof emp.secondary_shift_id === 'object'
                ? String(emp.secondary_shift_id?._id || emp.secondary_shift_id)
                : String(emp.secondary_shift_id || '');
            const shift = allShifts.find(s => String(s._id) === secId);
            return shift ? shift.name : 'Turno ?';
        }

        // Construir tabla
        let html = `<div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
            <thead>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
                    <th style="text-align:left; padding:8px 12px; color:var(--text-muted); font-weight:500;">Semana</th>`;

        rotators.forEach(r => {
            html += `<th style="text-align:center; padding:8px 12px; color:var(--text-muted); font-weight:500;">${r.full_name}</th>`;
        });
        html += `</tr></thead><tbody>`;

        weeks.forEach(week => {
            const weekStartIso = week.weekStart.toISOString().split('T')[0];
            html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 12px; color:var(--text-muted); font-size:0.8rem; white-space:nowrap;">${week.label}</td>`;

            rotators.forEach(r => {
                const empId = String(r._id);
                const key   = `${empId}_${weekStartIso}`;
                const plan  = planMap[key];

                let badge, onclick;
                if (plan) {
                    // Está rotando a turno secundario esta semana
                    const toPlan = typeof plan.to_shift_id === 'object' ? plan.to_shift_id : null;
                    const toName = toPlan ? (toPlan.name || getSecondaryShiftName(r)) : getSecondaryShiftName(r);
                    badge = `<span style="background:#ea580c; color:white; padding:3px 10px; border-radius:4px; cursor:pointer; font-size:0.78rem; display:inline-block;"
                        title="Haz clic para volver a turno principal">🔄 ${toName}</span>`;
                    onclick = `turnosApp.toggleRotation('${empId}', '${currentShift._id}', '', '${weekStartIso}', '${week.weekEnd.toISOString().split('T')[0]}', '${plan.id || plan._id}')`;
                } else {
                    // Está en turno principal
                    const secShiftId = typeof r.secondary_shift_id === 'object'
                        ? String(r.secondary_shift_id?._id || r.secondary_shift_id || '')
                        : String(r.secondary_shift_id || '');
                    badge = `<span style="background:#4f46e5; color:white; padding:3px 10px; border-radius:4px; cursor:pointer; font-size:0.78rem; display:inline-block;"
                        title="Haz clic para rotar a turno secundario">${currentShift.name}</span>`;
                    onclick = secShiftId
                        ? `turnosApp.toggleRotation('${empId}', '${currentShift._id}', '${secShiftId}', '${weekStartIso}', '${week.weekEnd.toISOString().split('T')[0]}', null)`
                        : `alert('Este rotativo no tiene turno secundario configurado. Ve a Personal.')`;
                }

                html += `<td style="padding:8px 12px; text-align:center;" onclick="${onclick}">${badge}</td>`;
            });
            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        html += `<p style="margin-top:0.75rem; font-size:0.78rem; color:var(--text-muted);">Haz clic en una celda para cambiar el turno de esa semana.</p>`;
        wrap.innerHTML = html;
    }

    async function toggleRotation(empId, fromShiftId, toShiftId, weekStart, weekEnd, planId) {
        if (planId) {
            // Volver a turno principal: eliminar el plan
            const res = await apiDelete(`/shifts/rotation-plan/${planId}`);
            if (res) { showAlert('Rotación eliminada', 'success'); loadRotationTab(); }
        } else {
            // Rotar a turno secundario: crear plan
            const res = await apiPost('/shifts/rotation-plan', {
                employee_id:   empId,
                from_shift_id: fromShiftId,
                to_shift_id:   toShiftId,
                week_start:    weekStart,
                week_end:      weekEnd,
            });
            if (res) { showAlert('Rotación guardada', 'success'); loadRotationTab(); }
        }
    }

    // ── Expose ────────────────────────────────────────────────────────────────

    return {
        init, onLocationChange, onShiftChange,
        prevMonth, nextMonth,
        loadEmployees, unassignEmployee,
        openAssignModal, closeAssignModal, filterAssignList, assignEmployee, reassignEmployee,
        openShiftModal, closeShiftModal, deleteShift,
        publishSchedule,
        toggleRotativo, closeRotativoModal, confirmMarkRotativo,
        rotPrevMonth, rotNextMonth, loadRotationTab, toggleRotation,
    };

})();

// Publicar preview al cambiar el mes
document.addEventListener('DOMContentLoaded', () => {
    const pm = document.getElementById('publishMonth');
    if (pm) pm.addEventListener('change', () => turnosApp && turnosApp.publishSchedule && turnosApp);
});
