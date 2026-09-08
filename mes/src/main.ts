import './styles.css';
import { buildDefaultCalendar } from './core/operationalCalendar';
import { buildDeterministicSchedule } from './core/scheduler';
import { renderDispatchBoard } from './ui/dispatchBoard';
import { MesState, ProductionTask } from './types';
import { loadState, saveState } from './services/storage';

const horizonStart = new Date(Date.now()).toISOString();
const horizonEnd = new Date(Date.now() + 14 * 86400000).toISOString();

const shifts = [
  { id: 'SHIFT-DAY', name: 'Дневная 08:00–20:00', startMinute: 8 * 60, durationMinutes: 12 * 60 },
  { id: 'SHIFT-NIGHT', name: 'Ночная 20:00–08:00', startMinute: 20 * 60, durationMinutes: 12 * 60 }
];
const calendar = buildDefaultCalendar(horizonStart, horizonEnd, shifts.map(s => s.id));

const seed: MesState = {
  plan: { id: 'mes-demo-plan', version: 1, horizonStart, horizonEnd, status: 'DRAFT' },
  products: [
    { id: 'P-001', code: 'PANEL-01', name: 'Сотовая панель', unit: 'м²' },
    { id: 'P-002', code: 'PANEL-02', name: 'Сэндвич-панель', unit: 'м²' }
  ],
  employees: [
    { id: 'E-001', personnelNo: '1001', name: 'Иванов Сергей', profession: 'Оператор участка', qualificationLevel: 3, active: true },
    { id: 'E-002', personnelNo: '1002', name: 'Петров Алексей', profession: 'Оператор участка', qualificationLevel: 2, active: true },
    { id: 'E-003', personnelNo: '1003', name: 'Смирнов Андрей', profession: 'Оператор участка', qualificationLevel: 3, active: true }
  ],
  equipment: [
    { id: 'EQ-001', code: 'LASER-01', name: 'Лазерный станок №1', workCenter: 'Лазерная резка', capabilities: ['CUT'], active: true },
    { id: 'EQ-002', code: 'GLUE-01', name: 'Пост склейки №1', workCenter: 'Склейка', capabilities: ['GLUE'], active: true }
  ],
  shifts,
  calendar,
  employeeSchedules: [
    ...calendar.filter(d => d.isWorking).map(d => ({ employeeId: 'E-001', date: d.date, shiftIds: ['SHIFT-DAY'], status: 'WORK' as const })),
    ...calendar.filter(d => d.isWorking).map(d => ({ employeeId: 'E-002', date: d.date, shiftIds: ['SHIFT-DAY'], status: 'WORK' as const })),
    ...calendar.filter(d => d.isWorking).map(d => ({ employeeId: 'E-003', date: d.date, shiftIds: ['SHIFT-NIGHT'], status: 'WORK' as const }))
  ],
  equipmentBlocks: [
    { id: 'EB-001', equipmentId: 'EQ-001', start: new Date(Date.now() + 2 * 86400000 + 12 * 3600000).toISOString(), end: new Date(Date.now() + 2 * 86400000 + 16 * 3600000).toISOString(), reason: 'MAINTENANCE', comment: 'Плановое ТО' }
  ],
  orders: [
    {
      id: 'O-001', number: 'ЗК-1001', productId: 'P-001', quantity: 120, completedQuantity: 0,
      dueAt: new Date(Date.now() + 5 * 86400000).toISOString(), priority: 'URGENT', status: 'RELEASED',
      route: [
        { id: 'OP-001', sequence: 10, code: 'CUT', name: 'Раскрой', workCenter: 'Лазерная резка', requiredQualification: 2, requiredEquipmentIds: ['EQ-001'], setupMinutes: 30, runMinutesPerUnit: 1.2 },
        { id: 'OP-002', sequence: 20, code: 'GLUE', name: 'Склейка', workCenter: 'Склейка', requiredQualification: 2, requiredEquipmentIds: ['EQ-002'], setupMinutes: 20, runMinutesPerUnit: 2.0 }
      ]
    },
    {
      id: 'O-002', number: 'ЗК-1002', productId: 'P-002', quantity: 80, completedQuantity: 0,
      dueAt: new Date(Date.now() + 9 * 86400000).toISOString(), priority: 'NORMAL', status: 'PLANNED',
      route: [
        { id: 'OP-003', sequence: 10, code: 'CUT', name: 'Раскрой', workCenter: 'Лазерная резка', requiredQualification: 2, requiredEquipmentIds: ['EQ-001'], setupMinutes: 30, runMinutesPerUnit: 1.0 },
        { id: 'OP-004', sequence: 20, code: 'GLUE', name: 'Склейка', workCenter: 'Склейка', requiredQualification: 2, requiredEquipmentIds: ['EQ-002'], setupMinutes: 20, runMinutesPerUnit: 1.7 }
      ]
    }
  ],
  tasks: [], downtimes: [], maintenance: [], results: [], events: []
};

const state = loadState(seed);
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения');
const root = app;
const operations = state.orders.flatMap(order => order.route);

function calculate(): void {
  const result = buildDeterministicSchedule({
    orders: state.orders,
    employees: state.employees,
    equipment: state.equipment,
    horizonStart: state.plan.horizonStart,
    horizonEnd: state.plan.horizonEnd,
    shifts: state.shifts,
    calendar: state.calendar,
    employeeSchedules: state.employeeSchedules,
    equipmentBlocks: state.equipmentBlocks
  });
  state.tasks = result.tasks;
  saveState(state);
}

if (state.tasks.length === 0) calculate();

function updateTask(taskId: string, patch: Partial<ProductionTask>): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  Object.assign(task, patch);
  task.version += 1;
  saveState(state);
  render();
}

function moveTask(taskId: string, deltaMinutes: number): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const delta = deltaMinutes * 60_000;
  updateTask(taskId, {
    plannedStart: new Date(new Date(task.plannedStart).getTime() + delta).toISOString(),
    plannedEnd: new Date(new Date(task.plannedEnd).getTime() + delta).toISOString()
  });
}

function render(): void {
  const completed = state.results.reduce((sum, r) => sum + r.goodQuantity, 0);
  const blockedByMaintenance = state.equipmentBlocks.filter(b => b.reason === 'MAINTENANCE').length;
  const conflicts = state.tasks.flatMap(task => {
    const start = new Date(task.plannedStart).getTime();
    const end = new Date(task.plannedEnd).getTime();
    const conflictsForTask = state.tasks.filter(other => {
      if (other.id === task.id) return false;
      const otherStart = new Date(other.plannedStart).getTime();
      const otherEnd = new Date(other.plannedEnd).getTime();
      return start < otherEnd && otherStart < end &&
        (task.assignedEmployeeIds.some(id => other.assignedEmployeeIds.includes(id)) ||
         task.assignedEquipmentIds.some(id => other.assignedEquipmentIds.includes(id)));
    });
    return conflictsForTask.length ? [task] : [];
  });

  root.innerHTML = `
    <header class="topbar">
      <div><div class="eyebrow">ТЕХНОХАБ ЗСМК</div><h1>MES • Производственное управление</h1></div>
      <div class="plan-badge">План v${state.plan.version} · ${state.plan.status}</div>
    </header>
    <main class="page">
      <section class="kpis">
        <article><span>Заказы</span><strong>${state.orders.length}</strong></article>
        <article><span>Задания</span><strong>${state.tasks.length}</strong></article>
        <article><span>Выпущено</span><strong>${completed}</strong></article>
        <article class="${conflicts.length ? 'danger' : ''}"><span>Конфликты</span><strong>${conflicts.length}</strong></article>
        <article><span>Простои</span><strong>${state.downtimes.length}</strong></article>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h2>Оперативный план и диспетчеризация</h2><div class="subtle">14 дней · ${state.shifts.length} смены · ${blockedByMaintenance} блокировки</div></div><button id="recalc" class="primary">Пересчитать автоматически</button></div>
        ${renderDispatchBoard({
          tasks: state.tasks,
          employees: state.employees,
          equipment: state.equipment,
          shifts: state.shifts,
          calendar: state.calendar,
          equipmentBlocks: state.equipmentBlocks,
          operations,
          onMove: moveTask,
          onAssignEmployee: (taskId, employeeId) => updateTask(taskId, { assignedEmployeeIds: employeeId ? [employeeId] : [] }),
          onAssignEquipment: (taskId, equipmentId) => updateTask(taskId, { assignedEquipmentIds: equipmentId ? [equipmentId] : [] })
        })}
      </section>

      <section class="grid-2">
        <div class="panel"><div class="panel-head"><h2>Заказы</h2></div>
          <table><thead><tr><th>Заказ</th><th>Приоритет</th><th>Срок</th><th>Статус</th></tr></thead><tbody>
            ${state.orders.map(o => `<tr><td><strong>${o.number}</strong></td><td>${o.priority}</td><td>${new Date(o.dueAt).toLocaleDateString('ru-RU')}</td><td>${o.status}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div class="panel"><div class="panel-head"><h2>Задания</h2></div>
          <table><thead><tr><th>Задание</th><th>Операция</th><th>Интервал</th><th>Сотрудник</th><th>Оборудование</th><th>Версия</th></tr></thead><tbody>
            ${state.tasks.map(t => {
              const op = operations.find(x => x.id === t.operationId);
              const e = state.employees.find(x => x.id === t.assignedEmployeeIds[0]);
              const eq = state.equipment.find(x => x.id === t.assignedEquipmentIds[0]);
              const conflict = conflicts.some(c => c.id === t.id);
              return `<tr class="${conflict ? 'row-conflict' : ''}"><td>${t.id}</td><td>${op?.name ?? t.operationId}</td><td>${new Date(t.plannedStart).toLocaleString('ru-RU')} → ${new Date(t.plannedEnd).toLocaleString('ru-RU')}</td><td>${e?.name ?? '—'}</td><td>${eq?.name ?? '—'}</td><td>v${t.version}</td></tr>`;
            }).join('')}
          </tbody></table>
        </div>
      </section>
    </main>`;

  root.querySelector<HTMLButtonElement>('#recalc')?.addEventListener('click', () => {
    state.tasks = [];
    calculate();
    render();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
    button.addEventListener('click', () => moveTask(button.dataset.move ?? '', Number(button.dataset.delta ?? 0)));
  });
  root.querySelectorAll<HTMLSelectElement>('[data-employee]').forEach(select => {
    select.addEventListener('change', () => updateTask(select.dataset.employee ?? '', { assignedEmployeeIds: select.value ? [select.value] : [] }));
  });
  root.querySelectorAll<HTMLSelectElement>('[data-equipment]').forEach(select => {
    select.addEventListener('change', () => updateTask(select.dataset.equipment ?? '', { assignedEquipmentIds: select.value ? [select.value] : [] }));
  });
}

render();
