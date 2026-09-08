import './styles.css';
import { buildDefaultCalendar } from './core/operationalCalendar';
import { buildDeterministicSchedule } from './core/scheduler';
import { executeTaskAction, recordProductionResult, startDowntime, endDowntime } from './core/execution';
import { buildPlanFactSummary } from './core/planFact';
import { renderDispatchBoard } from './ui/dispatchBoard';
import { bindCalendarEditor, renderCalendarEditor } from './ui/calendarEditor';
import { bindExecutionPanel, renderExecutionPanel } from './ui/executionPanel';
import { bindReplanPanel, renderReplanPanel, applyApprovedReplan } from './ui/replanPanel';
import { bindMaintenancePanel, renderMaintenancePanel } from './ui/maintenancePanel';
import { renderPlanFactPanel } from './ui/planFactPanel';
import { bindIntegrationPanel, renderIntegrationPanel } from './ui/integrationPanel';
import { browserWorkforceIntegrationStore } from './integration/workforce';
import { getMesAuthState, signInMes, signOutMes, subscribeMesAuth, MesAuthState } from './integration/auth';
import { SupabaseMesExecutionRpc, MesExecutionAction } from './integration/mesExecutionRpc';
import { SupabaseMesCalendarRpc } from './integration/mesCalendarRpc';
import { getMesSupabaseClient } from './services/supabase';
import { MesState, ProductionTask } from './types';
import { loadState, saveState } from './services/storage';

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 30;
const horizonStart = new Date(Date.now()).toISOString();
const horizonEnd = new Date(Date.now() + HORIZON_DAYS * DAY_MS).toISOString();
const shifts = [
  { id: 'SHIFT-DAY', name: 'Дневная 08:00–20:00', startMinute: 480, durationMinutes: 720 },
  { id: 'SHIFT-NIGHT', name: 'Ночная 20:00–08:00', startMinute: 1200, durationMinutes: 720 }
];
const calendar = buildDefaultCalendar(horizonStart, horizonEnd, shifts.map(s => s.id)).slice(0, HORIZON_DAYS);
const workingDays = calendar.filter(d => d.isWorking);

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
    ...workingDays.map(d => ({ employeeId: 'E-001', date: d.date, shiftIds: ['SHIFT-DAY'], status: 'WORK' as const })),
    ...workingDays.map(d => ({ employeeId: 'E-002', date: d.date, shiftIds: ['SHIFT-DAY'], status: 'WORK' as const })),
    ...workingDays.map(d => ({ employeeId: 'E-003', date: d.date, shiftIds: ['SHIFT-NIGHT'], status: 'WORK' as const }))
  ],
  equipmentBlocks: [{ id: 'EB-001', equipmentId: 'EQ-001', start: new Date(Date.now() + 2 * DAY_MS + 12 * 3600000).toISOString(), end: new Date(Date.now() + 2 * DAY_MS + 16 * 3600000).toISOString(), reason: 'MAINTENANCE', comment: 'Плановое ТО' }],
  orders: [
    { id: 'O-001', number: 'ЗК-1001', productId: 'P-001', quantity: 120, completedQuantity: 0, dueAt: new Date(Date.now() + 5 * DAY_MS).toISOString(), priority: 'URGENT', status: 'RELEASED', route: [
      { id: 'OP-001', sequence: 10, code: 'CUT', name: 'Раскрой', workCenter: 'Лазерная резка', requiredQualification: 2, requiredEquipmentIds: ['EQ-001'], setupMinutes: 30, runMinutesPerUnit: 1.2 },
      { id: 'OP-002', sequence: 20, code: 'GLUE', name: 'Склейка', workCenter: 'Склейка', requiredQualification: 2, requiredEquipmentIds: ['EQ-002'], setupMinutes: 20, runMinutesPerUnit: 2 }
    ] },
    { id: 'O-002', number: 'ЗК-1002', productId: 'P-002', quantity: 80, completedQuantity: 0, dueAt: new Date(Date.now() + 9 * DAY_MS).toISOString(), priority: 'NORMAL', status: 'PLANNED', route: [
      { id: 'OP-003', sequence: 10, code: 'CUT', name: 'Раскрой', workCenter: 'Лазерная резка', requiredQualification: 2, requiredEquipmentIds: ['EQ-001'], setupMinutes: 30, runMinutesPerUnit: 1 },
      { id: 'OP-004', sequence: 20, code: 'GLUE', name: 'Склейка', workCenter: 'Склейка', requiredQualification: 2, requiredEquipmentIds: ['EQ-002'], setupMinutes: 20, runMinutesPerUnit: 1.7 }
    ] }
  ],
  tasks: [], downtimes: [], maintenance: [], results: [], events: []
};

const state = loadState(seed);
const integrationStore = browserWorkforceIntegrationStore();
const supabase = getMesSupabaseClient();
const remoteExecution = supabase ? new SupabaseMesExecutionRpc(supabase) : null;
const remoteCalendar = supabase ? new SupabaseMesCalendarRpc(supabase) : null;
let authState: MesAuthState = { user: null, identity: null };
let authUnsubscribe: (() => void) | null = null;
let calendarSaveChain: Promise<void> = Promise.resolve();
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения');
const root = app;

function currentActorId(): string { return authState.identity?.userId ?? 'demo-dispatcher'; }
function remoteReady(): boolean { return Boolean(remoteExecution && authState.identity); }

function queueCalendarSave(): void {
  if (!remoteCalendar || !authState.identity) return;
  calendarSaveChain = calendarSaveChain
    .catch(() => undefined)
    .then(() => remoteCalendar.saveCalendar(state.calendar, state.employeeSchedules))
    .catch(showError);
}

function ensureHorizon(): void {
  const requiredEnd = new Date(state.plan.horizonStart).getTime() + HORIZON_DAYS * DAY_MS;
  if (new Date(state.plan.horizonEnd).getTime() >= requiredEnd && state.calendar.length >= HORIZON_DAYS) return;
  state.plan.horizonEnd = new Date(requiredEnd).toISOString();
  const generated = buildDefaultCalendar(state.plan.horizonStart, state.plan.horizonEnd, state.shifts.map(s => s.id)).slice(0, HORIZON_DAYS);
  const existing = new Map(state.calendar.map(d => [d.date, d]));
  state.calendar = generated.map(d => existing.get(d.date) ?? d);
  for (const employee of state.employees) for (const day of state.calendar) if (!state.employeeSchedules.some(s => s.employeeId === employee.id && s.date === day.date)) state.employeeSchedules.push({ employeeId: employee.id, date: day.date, shiftIds: [], status: 'OFF' });
  saveState(state);
}

function calculate(): void {
  const result = buildDeterministicSchedule({ orders: state.orders, employees: state.employees, equipment: state.equipment, horizonStart: state.plan.horizonStart, horizonEnd: state.plan.horizonEnd, shifts: state.shifts, calendar: state.calendar, employeeSchedules: state.employeeSchedules, equipmentBlocks: state.equipmentBlocks });
  state.tasks = result.tasks;
  saveState(state);
}

function updateTask(taskId: string, patch: Partial<ProductionTask>): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || ['COMPLETED', 'CANCELLED'].includes(task.status)) return;
  Object.assign(task, patch);
  task.version += 1;
  saveState(state);
  render();
}

function moveTask(taskId: string, deltaMinutes: number): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || ['COMPLETED', 'CANCELLED'].includes(task.status)) return;
  const delta = deltaMinutes * 60_000;
  updateTask(taskId, { plannedStart: new Date(new Date(task.plannedStart).getTime() + delta).toISOString(), plannedEnd: new Date(new Date(task.plannedEnd).getTime() + delta).toISOString() });
}

function updateCalendarDay(date: string, isWorking: boolean, shiftIds: string[]): void {
  const day = state.calendar.find(d => d.date === date); if (!day) return;
  day.isWorking = isWorking; day.shiftIds = isWorking ? shiftIds : [];
  if (!isWorking) state.employeeSchedules.filter(s => s.date === date).forEach(s => { s.status = 'OFF'; s.shiftIds = []; });
  calculate();
  render();
  queueCalendarSave();
}

function updateEmployeeSchedule(employeeId: string, date: string, status: 'WORK' | 'OFF' | 'VACATION' | 'SICK' | 'ABSENCE', shiftIds: string[]): void {
  const item = state.employeeSchedules.find(s => s.employeeId === employeeId && s.date === date);
  if (item) { item.status = status; item.shiftIds = shiftIds; } else state.employeeSchedules.push({ employeeId, date, status, shiftIds });
  calculate();
  render();
  queueCalendarSave();
}

function addEquipmentBlock(block: Omit<import('./types').EquipmentBlock, 'id'>): void { state.equipmentBlocks.push({ ...block, id: `EB-${Date.now()}` }); calculate(); render(); }
function removeEquipmentBlock(blockId: string): void { state.equipmentBlocks = state.equipmentBlocks.filter(b => b.id !== blockId); calculate(); render(); }
function applyControlledReplan(preview: import('./core/planFact').ReplanPreview): void {
  if (remoteReady()) return;
  applyApprovedReplan(state.tasks, preview); state.plan.version += 1; state.plan.status = 'DRAFT'; saveState(state); render();
}
function showError(error: unknown): void { window.alert(error instanceof Error ? error.message : 'Операция не выполнена'); }

function onMaintenanceChanged(): void { saveState(state); calculate(); render(); }

function mergeRemoteTask(remote: ProductionTask): void {
  const local = state.tasks.find(task => task.id === remote.id);
  if (!local) { state.tasks.push(remote); return; }
  const employees = local.assignedEmployeeIds;
  const equipment = local.assignedEquipmentIds;
  Object.assign(local, remote);
  local.assignedEmployeeIds = employees;
  local.assignedEquipmentIds = equipment;
}

async function handleAction(taskId: string, action: 'PREPARE' | MesExecutionAction): Promise<void> {
  if (remoteReady() && action !== 'PREPARE') {
    const task = await remoteExecution!.executeTaskAction(taskId, action, new Date().toISOString());
    mergeRemoteTask(task);
    saveState(state);
    render();
    return;
  }
  executeTaskAction(state, taskId, action, currentActorId());
  saveState(state);
  render();
}

async function handleResult(taskId: string, goodQuantity: number, scrapQuantity: number, comment: string): Promise<void> {
  if (remoteReady()) {
    const result = await remoteExecution!.recordProductionResult(taskId, goodQuantity, scrapQuantity, state.tasks.find(t => t.id === taskId)?.assignedEquipmentIds ?? [], comment, new Date().toISOString());
    if (!state.results.some(item => item.id === result.id)) state.results.push(result);
    const task = state.tasks.find(item => item.id === taskId);
    if (task) {
      task.actualQuantity += result.goodQuantity;
      if (task.actualQuantity >= task.plannedQuantity) { task.status = 'COMPLETED'; task.actualEnd ??= result.recordedAt; }
      else if (task.status === 'RUNNING' || task.status === 'PAUSED') task.status = 'PARTIALLY_COMPLETED';
      task.version += 1;
    }
    saveState(state);
    render();
    return;
  }
  const task = state.tasks.find(t => t.id === taskId);
  recordProductionResult(state, taskId, { goodQuantity, scrapQuantity, comment, employeeIds: task?.assignedEmployeeIds ?? [], equipmentIds: task?.assignedEquipmentIds ?? [] }, currentActorId());
  saveState(state);
  render();
}

async function handleDowntimeStart(equipmentId: string, reasonCode: string, comment: string): Promise<void> {
  if (remoteReady()) {
    const event = await remoteExecution!.startDowntime(equipmentId, reasonCode, comment, new Date().toISOString());
    state.downtimes.push(event);
    saveState(state);
    render();
    return;
  }
  startDowntime(state, { equipmentId, reasonCode, comment }, currentActorId());
  saveState(state);
  render();
}

async function handleDowntimeEnd(downtimeId: string): Promise<void> {
  if (remoteReady()) {
    const event = await remoteExecution!.endDowntime(downtimeId, new Date().toISOString());
    const local = state.downtimes.find(item => item.id === downtimeId);
    if (local) Object.assign(local, event); else state.downtimes.push(event);
    saveState(state);
    render();
    return;
  }
  endDowntime(state, downtimeId, currentActorId());
  saveState(state);
  render();
}

ensureHorizon();
if (state.tasks.length === 0) calculate();

function authHtml(): string {
  if (!supabase) return '<div class="plan-badge">Demo / localStorage</div>';
  if (authState.user) return `<div class="auth-inline"><span>${authState.identity?.role ?? 'MES user'} · ${authState.user.email ?? authState.user.id}</span><button id="signout" class="tiny">Выйти</button></div>`;
  return `<form id="login-form" class="auth-inline"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Пароль" required><button class="tiny" type="submit">Войти</button></form>`;
}

function render(): void {
  const operations = state.orders.flatMap(order => order.route);
  const totalGood = state.results.reduce((sum, r) => sum + r.goodQuantity, 0);
  const openDowntime = state.downtimes.filter(d => !d.endedAt).length;
  const summary = buildPlanFactSummary(state.tasks, state.results, state.downtimes);
  const conflicts = state.tasks.filter(task => state.tasks.some(other => other.id !== task.id && new Date(task.plannedStart).getTime() < new Date(other.plannedEnd).getTime() && new Date(other.plannedStart).getTime() < new Date(task.plannedEnd).getTime() && (task.assignedEmployeeIds.some(id => other.assignedEmployeeIds.includes(id)) || task.assignedEquipmentIds.some(id => other.assignedEquipmentIds.includes(id)))));

  const dispatchHtml = renderDispatchBoard({ tasks: state.tasks, employees: state.employees, equipment: state.equipment, shifts: state.shifts, calendar: state.calendar, equipmentBlocks: state.equipmentBlocks, operations, onMove: moveTask, onAssignEmployee: (taskId, employeeId) => updateTask(taskId, { assignedEmployeeIds: employeeId ? [employeeId] : [] }), onAssignEquipment: (taskId, equipmentId) => updateTask(taskId, { assignedEquipmentIds: equipmentId ? [equipmentId] : [] }) });
  const executionHtml = renderExecutionPanel({
    tasks: state.tasks, employees: state.employees, equipment: state.equipment, results: state.results, downtimes: state.downtimes,
    onAction: (taskId, action) => { void handleAction(taskId, action).catch(showError); },
    onResult: (taskId, goodQuantity, scrapQuantity, comment) => { void handleResult(taskId, goodQuantity, scrapQuantity, comment).catch(showError); },
    onDowntimeStart: (equipmentId, reasonCode, comment) => { void handleDowntimeStart(equipmentId, reasonCode, comment).catch(showError); },
    onDowntimeEnd: downtimeId => { void handleDowntimeEnd(downtimeId).catch(showError); }
  });
  const maintenanceHtml = renderMaintenancePanel({ state, actorId: currentActorId(), onChanged: onMaintenanceChanged, onError: showError });
  const planFactHtml = renderPlanFactPanel({ orders: state.orders, tasks: state.tasks, results: state.results, downtimes: state.downtimes });
  const replanHtml = renderReplanPanel({ tasks: state.tasks, downtimes: state.downtimes, plan: state.plan, onApply: applyControlledReplan });
  const integrationHtml = renderIntegrationPanel({ store: integrationStore, onRefresh: render });
  const calendarHtml = renderCalendarEditor({ calendar: state.calendar, shifts: state.shifts, employees: state.employees, employeeSchedules: state.employeeSchedules, equipment: state.equipment, equipmentBlocks: state.equipmentBlocks, onCalendarChange: updateCalendarDay, onEmployeeScheduleChange: updateEmployeeSchedule, onAddBlock: addEquipmentBlock, onRemoveBlock: removeEquipmentBlock });
  const orderRows = state.orders.map(o => `<tr><td><strong>${o.number}</strong></td><td>${o.priority}</td><td>${new Date(o.dueAt).toLocaleDateString('ru-RU')}</td><td>${o.status}</td></tr>`).join('');
  const taskRows = state.tasks.map(t => { const op = operations.find(o => o.id === t.operationId); const employee = state.employees.find(e => e.id === t.assignedEmployeeIds[0]); const equipment = state.equipment.find(e => e.id === t.assignedEquipmentIds[0]); const conflict = conflicts.some(c => c.id === t.id); return `<tr class="${conflict ? 'row-conflict' : ''}"><td>${t.id}</td><td>${op?.name ?? t.operationId}</td><td>${new Date(t.plannedStart).toLocaleString('ru-RU')} → ${new Date(t.plannedEnd).toLocaleString('ru-RU')}</td><td>${employee?.name ?? '—'}</td><td>${equipment?.name ?? '—'}</td><td>v${t.version}</td></tr>`; }).join('');

  root.innerHTML = `<header class="topbar"><div><div class="eyebrow">ТЕХНОХАБ ЗСМК</div><h1>MES • Производственное управление</h1></div><div class="auth-box">${authHtml()}</div></header>
  <main class="page"><section class="kpis"><article><span>Заказы</span><strong>${state.orders.length}</strong></article><article><span>Задания</span><strong>${state.tasks.length}</strong></article><article><span>Выпущено</span><strong>${totalGood}</strong></article><article class="${conflicts.length ? 'danger' : ''}"><span>Конфликты</span><strong>${conflicts.length}</strong></article><article><span>Открытые простои</span><strong>${openDowntime}</strong></article></section>
  <section class="panel"><div class="panel-head"><div><h2>Диспетчерская доска</h2><div class="subtle">30 дней · ${state.shifts.length} смены · ${state.equipmentBlocks.length} блокировки</div></div><button id="recalc" class="primary">Пересчитать</button></div>${dispatchHtml}</section>
  ${executionHtml}
  ${maintenanceHtml}
  ${replanHtml}
  ${integrationHtml}
  ${planFactHtml}
  <section class="panel">${calendarHtml}</section>
  <section class="panel"><div class="panel-head"><div><h2>Контроль выполнения</h2><div class="subtle">Активных заданий: ${summary.activeTasks} · Просроченных: ${summary.overdueTasks} · Простой: ${Math.round(summary.downtimeMinutes)} мин</div></div></div><div class="meta-row"><span>Выполнение: ${summary.completionPercent}%</span><span>Брак: ${summary.scrapQuantity}</span><span>Отклонение: ${summary.quantityVariance}</span></div></section>
  <section class="grid-2"><div class="panel"><div class="panel-head"><h2>Заказы</h2></div><table><thead><tr><th>Заказ</th><th>Приоритет</th><th>Срок</th><th>Статус</th></tr></thead><tbody>${orderRows}</tbody></table></div><div class="panel"><div class="panel-head"><h2>Задания</h2></div><table><thead><tr><th>Задание</th><th>Операция</th><th>Интервал</th><th>Сотрудник</th><th>Оборудование</th><th>Версия</th></tr></thead><tbody>${taskRows}</tbody></table></div></section></main>`;

  root.querySelector<HTMLButtonElement>('#recalc')?.addEventListener('click', () => { state.tasks = []; calculate(); render(); });
  root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => button.addEventListener('click', () => moveTask(button.dataset.move ?? '', Number(button.dataset.delta ?? 0))));
  root.querySelectorAll<HTMLSelectElement>('[data-employee]').forEach(select => select.addEventListener('change', () => { if (!authState.identity) updateTask(select.dataset.employee ?? '', { assignedEmployeeIds: select.value ? [select.value] : [] }); }));
  root.querySelectorAll<HTMLSelectElement>('[data-equipment]').forEach(select => select.addEventListener('change', () => { if (!authState.identity) updateTask(select.dataset.equipment ?? '', { assignedEquipmentIds: select.value ? [select.value] : [] }); }));
  root.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    void signInMes(supabase!, String(data.get('email') ?? ''), String(data.get('password') ?? '')).then(next => { authState = next; render(); }).catch(showError);
  });
  root.querySelector<HTMLButtonElement>('#signout')?.addEventListener('click', () => { void signOutMes(supabase!).catch(showError); });
  bindMaintenancePanel(root, { state, actorId: currentActorId(), onChanged: onMaintenanceChanged, onError: showError });
  bindReplanPanel(root, { tasks: state.tasks, downtimes: state.downtimes, plan: state.plan, onApply: applyControlledReplan });
  bindIntegrationPanel(root, { store: integrationStore, onRefresh: render });
  bindExecutionPanel(root, { tasks: state.tasks, employees: state.employees, equipment: state.equipment, results: state.results, downtimes: state.downtimes, onAction: (id, action) => { void handleAction(id, action).catch(showError); }, onResult: (id, good, scrap, comment) => { void handleResult(id, good, scrap, comment).catch(showError); }, onDowntimeStart: (equipmentId, reasonCode, comment) => { void handleDowntimeStart(equipmentId, reasonCode, comment).catch(showError); }, onDowntimeEnd: id => { void handleDowntimeEnd(id).catch(showError); } });
  bindCalendarEditor(root, { calendar: state.calendar, shifts: state.shifts, employees: state.employees, employeeSchedules: state.employeeSchedules, equipment: state.equipment, equipmentBlocks: state.equipmentBlocks, onCalendarChange: updateCalendarDay, onEmployeeScheduleChange: updateEmployeeSchedule, onAddBlock: addEquipmentBlock, onRemoveBlock: removeEquipmentBlock });
}

render();

void (async () => {
  if (!supabase) return;
  try {
    authState = await getMesAuthState(supabase);
    render();
    authUnsubscribe = subscribeMesAuth(supabase, async next => { authState = next; render(); });
  } catch (error) {
    showError(error);
  }
})();

window.addEventListener('beforeunload', () => authUnsubscribe?.());
