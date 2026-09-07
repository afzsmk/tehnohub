// scheduler/src/main.ts
import './styles/main.css';
import { ProductionOrder, StationScheduleConfig, ProductRouting, ShiftOverride, ScheduledTask, RoutingStep } from './types';
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
  setupRoutingsTab();
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
  renderOrdersTable(res.tasks);
  renderShiftGrid(slots);
  renderDispatchSheet();

  const statsEl = document.getElementById('ganttStats');
  if (statsEl) {
    statsEl.innerHTML = res.overdueOrdersCount > 0
      ? `<strong style="color:var(--danger)">⚠ Срыв сроков: ${res.overdueOrdersCount} заказ(а)</strong>`
      : `<span style="color:var(--success); font-weight:700;">✓ Все заказы укладываются в дедлайны</span>`;
  }
}

// 1. ДИАГРАММА ГАНТА С КЛИКОМ ПО ОПЕРАЦИИ
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

      const dayTasks = tasks.filter(t => t.professionId === st.professionId && t.startDate <= d && t.endDate >= d);
      dayTasks.forEach(t => {
        const color = palette[Math.abs(t.orderId.charCodeAt(t.orderId.length - 1)) % palette.length];
        html += `
          <div class="task-bar ${t.isOverdue ? 'overdue' : ''}" style="background:${color};" onclick="window._openTaskModal('${t.id}')">
            ${t.orderNumber}: ${t.quantity}${t.unit}
          </div>
        `;
      });

      html += `</div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;

  (window as any)._openTaskModal = (taskId: string) => {
    const task = currentScheduledTasks.find(t => t.id === taskId);
    if (!task) return;
    const allOrderTasks = currentScheduledTasks.filter(t => t.orderId === task.orderId).sort((a,b) => a.stepNumber - b.stepNumber);
    
    const bodyHtml = `
      <div style="line-height:1.6;">
        <div><strong>Заказ:</strong> ${task.orderNumber} (${task.productName})</div>
        <div><strong>Клиент:</strong> ${task.customer || '—'}</div>
        <div><strong>Объем партии:</strong> ${task.quantity} ${task.unit}</div>
        <div style="margin-top:10px; border-top:1px solid #e2e8f0; padding-top:8px;">
          <strong>Технологическая цепочка заказа:</strong>
          <div style="margin-top:6px; display:flex; flex-direction:column; gap:4px;">
            ${allOrderTasks.map(ot => `
              <div style="padding:6px 10px; border-radius:4px; background:${ot.id === task.id ? '#eff6ff' : '#f8fafc'}; border:1px solid ${ot.id === task.id ? '#3b82f6' : '#e2e8f0'}; display:flex; justify-content:space-between;">
                <span>Шаг ${ot.stepNumber}: <strong>${ot.professionName}</strong></span>
                <span>${ot.startDate} (${ot.plannedHours} н-ч) ${ot.isOverdue ? '<span style="color:red; font-weight:700;">⚠ Просрочен</span>' : ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    showModal(`Операция: ${task.orderNumber} на ${task.professionName}`, bodyHtml, [{ label: 'Закрыть', class: 'btn-secondary', action: closeModal }]);
  };
}

// 2. ИНТЕРАКТИВНЫЙ СМЕННЫЙ ТАБЕЛЬ И РЕМОНТЫ (ППР)
function renderShiftGrid(slots: any[]) {
  const thead = document.getElementById('shiftGridTableHeader');
  const tbody = document.getElementById('shiftGridTableBody');
  if (!thead || !tbody) return;

  const uniqueDates = Array.from(new Set(slots.map(s => s.date)));

  thead.innerHTML = `
    <th style="min-width:180px;">Станок / Участок</th>
    ${uniqueDates.map(d => `<th style="text-align:center; min-width:55px;">${d.slice(5)}</th>`).join('')}
  `;

  tbody.innerHTML = stations.map(st => `
    <tr>
      <td style="font-weight:700;">${st.professionName}</td>
      ${uniqueDates.map(d => {
        const slot = slots.find(s => s.professionId === st.professionId && s.date === d);
        let badge = `<span style="color:#cbd5e1;">—</span>`;
        if (slot) {
          if (slot.isMaintenance) badge = `<span style="background:#fee2e2; color:#991b1b; padding:2px 4px; border-radius:3px; font-weight:700;">ППР</span>`;
          else if (slot.isWorking) badge = `<span style="background:#eff6ff; color:#1e40af; padding:2px 4px; border-radius:3px; font-weight:700;">${slot.shiftHours}ч (${slot.availableWorkers}ч)</span>`;
          else badge = `<span style="color:#94a3b8;">Вых</span>`;
        }
        return `
          <td style="text-align:center; cursor:pointer;" onclick="window._editShift('${st.professionId}', '${d}', 1)" title="Кликните для настройки смены">
            ${badge}
          </td>
        `;
      }).join('')}
    </tr>
  `).join('');

  (window as any)._editShift = (profId: string, date: string, shiftNum: 1 | 2) => {
    const st = stations.find(s => s.professionId === profId);
    if (!st) return;
    const existing = overrides.find(o => o.professionId === profId && o.date === date && o.shiftNumber === shiftNum);

    const bodyHtml = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div><strong>Станок:</strong> ${st.professionName} | <strong>Дата:</strong> ${date}</div>
        <div>
          <label style="font-weight:600;">Режим смены:</label>
          <select id="modalShiftActive" class="input-control" style="margin-top:4px;">
            <option value="work" ${(!existing || existing.isActive) && !existing?.isMaintenance ? 'selected' : ''}>Рабочая смена</option>
            <option value="off" ${existing && !existing.isActive ? 'selected' : ''}>Выходной день</option>
            <option value="maint" ${existing?.isMaintenance ? 'selected' : ''}>Ремонт оборудования (ППР)</option>
          </select>
        </div>
        <div>
          <label style="font-weight:600;">Длительность смены (ч):</label>
          <input type="number" id="modalShiftHours" class="input-control" value="${existing?.shiftHours ?? st.defaultShiftHours}">
        </div>
        <div>
          <label style="font-weight:600;">Вышло рабочих (чел):</label>
          <input type="number" id="modalShiftWorkers" class="input-control" value="${existing?.availableWorkers ?? st.defaultWorkers}">
        </div>
        <div>
          <label style="font-weight:600;">Примечание:</label>
          <input type="text" id="modalShiftNote" class="input-control" placeholder="ТО лазера, сверхурочные..." value="${existing?.note || ''}">
        </div>
      </div>
    `;

    showModal(`Настройка смены: ${st.professionName}`, bodyHtml, [
      { label: 'Отмена', class: 'btn-secondary', action: closeModal },
      {
        label: 'Сохранить смену',
        class: 'btn-primary',
        action: () => {
          const mode = (document.getElementById('modalShiftActive') as HTMLSelectElement).value;
          const hours = Number((document.getElementById('modalShiftHours') as HTMLInputElement).value);
          const workers = Number((document.getElementById('modalShiftWorkers') as HTMLInputElement).value);
          const note = (document.getElementById('modalShiftNote') as HTMLInputElement).value;

          overrides = overrides.filter(o => !(o.professionId === profId && o.date === date && o.shiftNumber === shiftNum));
          overrides.push({
            professionId: profId,
            date,
            shiftNumber: shiftNum,
            isActive: mode === 'work',
            isMaintenance: mode === 'maint',
            shiftHours: mode === 'work' ? hours : 0,
            availableWorkers: mode === 'work' ? workers : 0,
            note
          });

          schedulerStorage.saveOverrides(overrides);
          closeModal();
          runScheduleAndRender();
        }
      }
    ]);
  };
}

// 3. БЭКЛОГ ЗАКАЗОВ С РАСЧЁТОМ ФИНИША И ПАРТИОНИРОВАНИЕМ
function renderOrdersTable(tasks: ScheduledTask[]) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  tbody.innerHTML = orders.map((o, idx) => {
    const orderTasks = tasks.filter(t => t.orderId === o.id);
    const lastTask = orderTasks.sort((a,b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0];
    const calcFinish = lastTask ? lastTask.endDate : '—';
    const isOverdue = lastTask ? lastTask.isOverdue : false;

    return `
      <tr>
        <td><strong>${o.orderNumber}</strong></td>
        <td>${o.customer || '—'}</td>
        <td>${o.productName}</td>
        <td style="text-align:right; font-weight:700;">${o.quantity}</td>
        <td style="text-align:center;">${o.unit}</td>
        <td style="text-align:center;">${o.dueDate}</td>
        <td style="text-align:center; font-weight:700; color:${isOverdue ? 'var(--danger)' : 'var(--success)'};">
          ${calcFinish} ${isOverdue ? '⚠️' : '✓'}
        </td>
        <td style="text-align:center;">
          <span style="font-weight:700; color:${o.priority === 'urgent' ? 'var(--danger)' : 'var(--text-primary)'}">
            ${o.priority === 'urgent' ? '🔥 Срочно' : 'Обычный'}
          </span>
        </td>
        <td style="text-align:center;">${o.status}</td>
        <td style="text-align:center; display:flex; gap:4px; justify-content:center;">
          <button class="btn btn-secondary btn-sm" onclick="window._splitOrder(${idx})" title="Разбить заказ на партии">✂</button>
          <button class="btn btn-secondary btn-sm" onclick="window._delOrder(${idx})" title="Удалить заказ">✕</button>
        </td>
      </tr>
    `;
  }).join('');

  // Функция партионирования: заказ разбивается на равные части с шагом по неделям
  (window as any)._splitOrder = (idx: number) => {
    const o = orders[idx];
    const parts = Number(prompt(`На сколько партий разбить заказ ${o.orderNumber} (объем: ${o.quantity} ${o.unit})?`, '2')) || 2;
    if (parts <= 1) return;

    const partQty = Math.round((o.quantity / parts) * 10) / 10;
    orders.splice(idx, 1);

    for (let p = 1; p <= parts; p++) {
      const partDue = new Date(new Date(o.dueDate).getTime() + (p - parts) * 3 * 86400000).toISOString().slice(0,10);
      orders.push({
        id: 'ord_' + Date.now() + '_' + p,
        orderNumber: `${o.orderNumber}/п${p}`,
        customer: o.customer,
        productId: o.productId,
        productName: o.productName,
        quantity: partQty,
        unit: o.unit,
        dueDate: partDue,
        priority: o.priority,
        status: 'new'
      });
    }

    schedulerStorage.saveOrders(orders);
    runScheduleAndRender();
  };

  (window as any)._delOrder = (idx: number) => {
    orders.splice(idx, 1);
    schedulerStorage.saveOrders(orders);
    runScheduleAndRender();
  };
}

// 4. КОНСТРУКТОР ТЕХНОЛОГИЧЕСКИХ МАРШРУТОВ
function setupRoutingsTab() {
  const prodSelect = document.getElementById('routingProductSelect') as HTMLSelectElement | null;
  if (!prodSelect) return;

  const productIds = Array.from(new Set(orders.map(o => o.productId)));
  prodSelect.innerHTML = productIds.map(pId => {
    const o = orders.find(x => x.productId === pId);
    return `<option value="${pId}">${o?.productName || pId}</option>`;
  }).join('');

  prodSelect.onchange = () => renderRoutingSteps();
  renderRoutingSteps();

  document.getElementById('btnAddRoutingStep')?.addEventListener('click', () => {
    const pId = prodSelect.value;
    if (!pId) return;
    if (!routings[pId]) {
      routings[pId] = { id: 'rt_' + pId, productId: pId, productName: orders.find(x => x.productId === pId)?.productName || pId, steps: [] };
    }
    const nextStep = (routings[pId].steps.length + 1) * 10;
    routings[pId].steps.push({
      stepNumber: nextStep,
      professionId: stations[0]?.professionId || 'p1',
      professionName: stations[0]?.professionName || 'Станок',
      normPerUnit: 0.1,
      setupTimeHours: 0.5,
      bufferHoursAfter: 0
    });
    schedulerStorage.saveRoutings(routings);
    renderRoutingSteps();
    runScheduleAndRender();
  });
}

function renderRoutingSteps() {
  const prodSelect = document.getElementById('routingProductSelect') as HTMLSelectElement | null;
  const tbody = document.getElementById('routingStepsTableBody');
  if (!prodSelect || !tbody) return;

  const pId = prodSelect.value;
  const rt = routings[pId];
  if (!rt || !rt.steps || rt.steps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:16px; color:var(--text-muted);">Для этого изделия ещё не настроен маршрут. Нажмите «+ Добавить шаг».</td></tr>`;
    return;
  }

  tbody.innerHTML = rt.steps.map((st, idx) => `
    <tr>
      <td style="text-align:center; font-weight:700;">${st.stepNumber}</td>
      <td>
        <select class="input-control rt-station" data-idx="${idx}">
          ${stations.map(s => `<option value="${s.professionId}" ${s.professionId === st.professionId ? 'selected' : ''}>${s.professionName}</option>`).join('')}
        </select>
      </td>
      <td style="text-align:right;"><input type="number" step="0.001" class="input-control rt-norm" data-idx="${idx}" value="${st.normPerUnit}"></td>
      <td style="text-align:right;"><input type="number" step="0.5" class="input-control rt-setup" data-idx="${idx}" value="${st.setupTimeHours}"></td>
      <td style="text-align:right;"><input type="number" step="1" class="input-control rt-buffer" data-idx="${idx}" value="${st.bufferHoursAfter}"></td>
      <td style="text-align:center;"><button class="btn btn-secondary btn-sm" onclick="window._delRoutingStep(${idx})">✕</button></td>
    </tr>
  `).join('');

  tbody.onchange = (e) => {
    const target = e.target as HTMLElement;
    const idx = Number(target.getAttribute('data-idx'));
    const step = rt.steps[idx];
    if (!step) return;

    if (target.classList.contains('rt-station')) {
      const pId = (target as HTMLSelectElement).value;
      step.professionId = pId;
      step.professionName = stations.find(s => s.professionId === pId)?.professionName || pId;
    } else if (target.classList.contains('rt-norm')) step.normPerUnit = Number((target as HTMLInputElement).value);
    else if (target.classList.contains('rt-setup')) step.setupTimeHours = Number((target as HTMLInputElement).value);
    else if (target.classList.contains('rt-buffer')) step.bufferHoursAfter = Number((target as HTMLInputElement).value);

    schedulerStorage.saveRoutings(routings);
    runScheduleAndRender();
  };

  (window as any)._delRoutingStep = (idx: number) => {
    rt.steps.splice(idx, 1);
    schedulerStorage.saveRoutings(routings);
    renderRoutingSteps();
    runScheduleAndRender();
  };
}

// 5. ЭКРАН Б (ССЗ / ЛИСТ МАСТЕРА)
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

// 6. ТЕПЛОВАЯ КАРТА
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

function showModal(title: string, bodyHtml: string, buttons: any[]) {
  const overlay = document.getElementById('customModalOverlay')!;
  document.getElementById('modalTitle')!.innerHTML = title;
  document.getElementById('modalBody')!.innerHTML = bodyHtml;
  const footer = document.getElementById('modalFooter')!;
  footer.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn ${b.class || 'btn-secondary'}`;
    btn.textContent = b.label;
    btn.onclick = b.action;
    footer.appendChild(btn);
  });
  overlay.style.display = 'flex';
}

function closeModal() {
  const overlay = document.getElementById('customModalOverlay')!;
  overlay.style.display = 'none';
}

window.addEventListener('DOMContentLoaded', init);
