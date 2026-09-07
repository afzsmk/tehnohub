// scheduler/src/main.ts
import './styles/main.css';
import { ProductionOrder, StationScheduleConfig, ProductRouting, ShiftOverride, ScheduledTask } from './types';
import { generateStationCalendar } from './core/calendar';
import { buildSchedule } from './core/schedulerEngine';
import { schedulerStorage, DEFAULT_STATIONS, DEFAULT_ROUTINGS, DEFAULT_ORDERS } from './services/schedulerStorage';

let orders: ProductionOrder[] = [];
let routings: Record<string, ProductRouting> = {};
let stations: StationScheduleConfig[] = [];
let overrides: ShiftOverride[] = [];

let daysCount = 14;
let startDate = new Date().toISOString().slice(0, 10);
let currentScheduledTasks: ScheduledTask[] = [];

async function init() {
  const data = await schedulerStorage.loadData();
  orders = data.orders.length ? data.orders : DEFAULT_ORDERS;
  routings = Object.keys(data.routings).length ? data.routings : DEFAULT_ROUTINGS;
  stations = data.stations.length ? data.stations : DEFAULT_STATIONS;
  overrides = data.overrides || [];

  const startInput = document.getElementById('inputStartDate') as HTMLInputElement | null;
  if (startInput) startInput.value = startDate;

  const dispatchDate = document.getElementById('dispatchDateSelect') as HTMLInputElement | null;
  if (dispatchDate) dispatchDate.value = startDate;

  setupTabs();
  setupHorizonButtons();
  attachEvents();
  runScheduleAndRender();
}

function runScheduleAndRender() {
  const slots = generateStationCalendar({
    startDate,
    daysCount,
    stations,
    overrides
  });

  const res = buildSchedule({ orders, routings, slots });
  currentScheduledTasks = res.tasks;

  renderGantt(slots, res.tasks);
  renderHeatmap(res.dayLoads, slots);
  renderOrdersTable();
  renderStationsTable();
  renderDispatchSheet();

  const statsEl = document.getElementById('ganttStats');
  if (statsEl) {
    statsEl.innerHTML = res.overdueOrdersCount > 0
      ? `<strong style="color:var(--danger)">⚠ Срыв сроков: ${res.overdueOrdersCount} заказ(а)</strong>`
      : `<span style="color:var(--success); font-weight:700;">✓ Все заказы укладываются в дедлайны</span>`;
  }
}

// РЕНДЕРИНГ ЭКРАНА А (ГАНТ)
function renderGantt(slots: any[], tasks: ScheduledTask[]) {
  const container = document.getElementById('ganttContainer');
  if (!container) return;

  const uniqueDates = Array.from(new Set(slots.map(s => s.date)));
  const palette = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

  let html = `<div class="gantt-header-row">`;
  html += `<div class="gantt-col-station">Станок / Пост</div>`;
  uniqueDates.forEach(d => {
    const dayOfWeek = new Date(d).getDay();
    const isWk = dayOfWeek === 0 || dayOfWeek === 6;
    const shortDate = d.slice(5);
    html += `<div class="gantt-day-col ${isWk ? 'weekend' : ''}"><strong>${shortDate}</strong><br>${isWk ? 'Вых' : 'Раб'}</div>`;
  });
  html += `</div>`;

  stations.forEach(st => {
    html += `<div class="gantt-row">`;
    html += `<div class="gantt-station-cell">${st.professionName}</div>`;

    uniqueDates.forEach(d => {
      const daySlot = slots.find(s => s.professionId === st.professionId && s.date === d);
      const isWk = daySlot?.isWeekend;
      html += `<div class="gantt-slot ${isWk ? 'weekend' : ''}">`;

      // Находим задачи этого станка в этот день
      const dayTasks = tasks.filter(t => t.professionId === st.professionId && t.startDate <= d && t.endDate >= d);
      dayTasks.forEach((t, i) => {
        const color = palette[Math.abs(t.orderId.charCodeAt(t.orderId.length - 1)) % palette.length];
        html += `
          <div class="task-bar ${t.isOverdue ? 'overdue' : ''}" style="background:${color};" title="${t.orderNumber} (${t.productName}) — ${t.plannedHours} н-ч">
            ${t.orderNumber}: ${t.quantity}${t.unit}
          </div>
        `;
      });

      html += `</div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

// РЕНДЕРИНГ ЭКРАНА Б (ССЗ / ЛИСТ МАСТЕРА)
function renderDispatchSheet() {
  const tbody = document.getElementById('dispatchTableBody');
  const metaEl = document.getElementById('dispatchDocMeta');
  const dateInput = document.getElementById('dispatchDateSelect') as HTMLInputElement | null;
  const shiftSelect = document.getElementById('dispatchShiftSelect') as HTMLSelectElement | null;
  if (!tbody || !dateInput || !shiftSelect) return;

  const targetDate = dateInput.value;
  const targetShift = Number(shiftSelect.value) as 1 | 2;

  if (metaEl) {
    metaEl.innerHTML = `
      <div><strong>Дата:</strong> ${targetDate}</div>
      <div><strong>Смена:</strong> ${targetShift === 1 ? '1 смена (08:00 – 17:00)' : '2 смена (17:00 – 01:30)'}</div>
    `;
  }

  const shiftTasks = currentScheduledTasks.filter(t => t.startDate <= targetDate && t.endDate >= targetDate);

  if (shiftTasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:16px; color:var(--text-muted);">На выбранную смену нет запланированных операций.</td></tr>`;
    return;
  }

  tbody.innerHTML = shiftTasks.map((t, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${t.professionName}</strong></td>
      <td>${t.orderNumber} ${t.customer ? `(${t.customer})` : ''}</td>
      <td>${t.productName}</td>
      <td style="text-align:right;">${t.quantity} ${t.unit}</td>
      <td style="text-align:right; font-weight:700;">${t.plannedHours}</td>
      <td style="text-align:center;">[ &nbsp;&nbsp;&nbsp;&nbsp; ]</td>
      <td style="text-align:center;">[ &nbsp; ]</td>
    </tr>
  `).join('');
}

// РЕНДЕРИНГ ЭКРАНА В (ТЕПЛОВАЯ КАРТА)
function renderHeatmap(dayLoads: any[], slots: any[]) {
  const thead = document.getElementById('heatmapTableHeader');
  const tbody = document.getElementById('heatmapTableBody');
  if (!thead || !tbody) return;

  const uniqueDates = Array.from(new Set(slots.map(s => s.date)));

  thead.innerHTML = `
    <th style="min-width:180px;">Оборудование</th>
    ${uniqueDates.map(d => `<th style="text-align:center; min-width:55px;">${d.slice(5)}</th>`).join('')}
    <th style="text-align:center; min-width:80px;">Средняя</th>
  `;

  tbody.innerHTML = stations.map(st => {
    const stationLoads = dayLoads.filter(l => l.professionId === st.professionId);
    const avgLoad = stationLoads.length ? Math.round(stationLoads.reduce((a, b) => a + b.loadPercent, 0) / stationLoads.length) : 0;

    return `
      <tr>
        <td style="font-weight:700;">${st.professionName}</td>
        ${uniqueDates.map(d => {
          const load = stationLoads.find(l => l.date === d);
          const pct = load ? load.loadPercent : 0;
          const zone = load ? load.zone : 'empty';
          return `<td class="tile-${zone}">${pct > 0 ? pct + '%' : '—'}</td>`;
        }).join('')}
        <td style="font-weight:700;">${avgLoad}%</td>
      </tr>
    `;
  }).join('');
}

// РЕНДЕРИНГ ЖУРНАЛА ЗАКАЗОВ
function renderOrdersTable() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  tbody.innerHTML = orders.map((o, idx) => `
    <tr>
      <td><strong>${o.orderNumber}</strong></td>
      <td>${o.customer || '—'}</td>
      <td>${o.productName}</td>
      <td style="text-align:right; font-weight:700;">${o.quantity}</td>
      <td style="text-align:center;">${o.unit}</td>
      <td style="text-align:center;">${o.dueDate}</td>
      <td style="text-align:center;">
        <span style="font-weight:700; color:${o.priority === 'urgent' ? 'var(--danger)' : 'var(--text-primary)'}">
          ${o.priority === 'urgent' ? '🔥 Срочно' : 'Обычный'}
        </span>
      </td>
      <td style="text-align:center;">${o.status}</td>
      <td style="text-align:center;">
        <button class="btn btn-secondary btn-sm" onclick="window._delOrder(${idx})">✕</button>
      </td>
    </tr>
  `).join('');

  (window as any)._delOrder = (idx: number) => {
    orders.splice(idx, 1);
    schedulerStorage.saveOrders(orders);
    runScheduleAndRender();
  };
}

// РЕНДЕРИНГ ТАБЛИЦЫ СМЕН СТАНКОВ
function renderStationsTable() {
  const tbody = document.getElementById('stationsTableBody');
  if (!tbody) return;

  tbody.innerHTML = stations.map(st => `
    <tr>
      <td><strong>${st.professionName}</strong></td>
      <td>
        <select class="input-control st-pattern" data-id="${st.professionId}">
          <option value="5_2_single" ${st.pattern === '5_2_single' ? 'selected' : ''}>5/2 (1 смена 8ч)</option>
          <option value="2_2_12h" ${st.pattern === '2_2_12h' ? 'selected' : ''}>2/2 (1 смена 12ч без вых)</option>
          <option value="continuous_24h" ${st.pattern === 'continuous_24h' ? 'selected' : ''}>Круглосуточно (24ч)</option>
        </select>
      </td>
      <td style="text-align:right;"><input type="number" class="input-control st-hours" data-id="${st.professionId}" value="${st.defaultShiftHours}"></td>
      <td style="text-align:right;">${st.shiftsPerDay}</td>
      <td style="text-align:right;">${st.totalMachines}</td>
      <td style="text-align:right;">${st.crewPerMachine}</td>
      <td style="text-align:right;"><input type="number" class="input-control st-workers" data-id="${st.professionId}" value="${st.defaultWorkers}"></td>
    </tr>
  `).join('');

  tbody.onchange = (e) => {
    const target = e.target as HTMLElement;
    const id = target.getAttribute('data-id');
    const st = stations.find(s => s.professionId === id);
    if (!st) return;

    if (target.classList.contains('st-pattern')) st.pattern = (target as HTMLSelectElement).value as any;
    else if (target.classList.contains('st-hours')) st.defaultShiftHours = Number((target as HTMLInputElement).value);
    else if (target.classList.contains('st-workers')) st.defaultWorkers = Number((target as HTMLInputElement).value);

    schedulerStorage.saveStations(stations);
    runScheduleAndRender();
  };
}

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      if (tab) document.getElementById(tab)?.classList.add('active');
    });
  });
}

function setupHorizonButtons() {
  document.querySelectorAll('.horizon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.horizon-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      daysCount = Number(btn.getAttribute('data-days')) || 14;
      runScheduleAndRender();
    });
  });
}

function attachEvents() {
  document.getElementById('inputStartDate')?.addEventListener('change', (e: any) => {
    startDate = e.target.value;
    runScheduleAndRender();
  });

  document.getElementById('btnAutoSchedule')?.addEventListener('click', () => {
    runScheduleAndRender();
  });

  document.getElementById('dispatchDateSelect')?.addEventListener('change', () => renderDispatchSheet());
  document.getElementById('dispatchShiftSelect')?.addEventListener('change', () => renderDispatchSheet());

  // Добавление нового заказа
  document.getElementById('btnAddOrder')?.addEventListener('click', () => {
    const num = prompt('Номер заказа (например, ЗК-108):', `ЗК-${Math.floor(100 + Math.random() * 900)}`);
    if (!num) return;
    const qty = Number(prompt('Объем партии (м²):', '50')) || 50;
    const due = prompt('Дедлайн сдачи (ГГГГ-ММ-ДД):', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    if (!due) return;

    orders.push({
      id: 'ord_' + Date.now(),
      orderNumber: num,
      customer: 'Новый заказчик',
      productId: 'pr1',
      productName: 'Сотовые панели Кемерово',
      quantity: qty,
      unit: 'м²',
      dueDate: due,
      priority: 'normal',
      status: 'new'
    });

    schedulerStorage.saveOrders(orders);
    runScheduleAndRender();
  });
}

window.addEventListener('DOMContentLoaded', init);
