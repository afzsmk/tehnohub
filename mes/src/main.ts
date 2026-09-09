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
import { SupabaseMesPlanningRpc } from './integration/mesPlanningRpc';
import { SupabaseMesReplanRpc } from './integration/mesReplanRpc';
import { SupabaseMesEquipmentBlockRpc } from './integration/mesEquipmentBlockRpc';
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
const remotePlanning = supabase ? new SupabaseMesPlanningRpc(supabase) : null;
const remoteReplan = supabase ? new SupabaseMesReplanRpc(supabase) : null;
const remoteEquipmentBlocks = supabase ? new SupabaseMesEquipmentBlockRpc(supabase) : null;
let authState: MesAuthState = { user: null, identity: null };
let authUnsubscribe: (() => void) | null = null;
let calendarSaveChain: Promise<void> = Promise.resolve();
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения');
const root = app;

function currentActorId(): string { return authState.identity?.userId ?? 'demo-dispatcher'; }
function remoteReady(): boolean { return Boolean(remoteExecution && authState.identity); }
function remoteEquipmentBlocksReady(): boolean { return Boolean(remoteEquipmentBlocks && authState.identity); }

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

async function moveTask(taskId: string, deltaMinutes: number): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || ['COMPLETED', 'CANCELLED'].includes(task.status)) return;
  const delta = deltaMinutes * 60_000;
  const plannedStart = new Date(new Date(task.plannedStart).getTime() + delta).toISOString();
  const plannedEnd = new Date(new Date(task.plannedEnd).getTime() + delta).toISOString();

  if (remoteReady() && remoteReplan) {
    const plan = await remoteReplan.apply(state.plan.id, state.plan.version, [{
      taskId: task.id,
      proposedStart: plannedStart,
      proposedEnd: plannedEnd,
      expectedVersion: task.version
    }]);
    task.plannedStart = plannedStart;
    task.plannedEnd = plannedEnd;
    task.version += 1;
    state.plan = plan;
    saveState(state);
    render();
    return;
  }

  updateTask(taskId, { plannedStart, plannedEnd });
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

async function addEquipmentBlock(block: Omit<import('./types').EquipmentBlock, 'id'>): Promise<void> {
  if (remoteEquipmentBlocksReady()) {
    try {
      const remoteBlock = await remoteEquipmentBlocks!.createBlock(block);
      state.equipmentBlocks.push(remoteBlock);
      calculate();
      render();
    } catch (error) { showError(error); }
    return;
  }
  state.equipmentBlocks.push({ ...block, id: `EB-${Date.now()}` });
  calculate();
  render();
}

async function removeEquipmentBlock(blockId: string): Promise<void> {
  if (remoteEquipmentBlocksReady()) {
    try {
      const remoteBlock = await remoteEquipmentBlocks!.deleteBlock(blockId);
      state.equipmentBlocks = state.equipmentBlocks.filter(block => block.id !== remoteBlock.id);
      calculate();
      render();
    } catch (error) { showError(error); }
    return;
  }
  state.equipmentBlocks = state.equipmentBlocks.filter(b => b.id !== blockId);
  calculate();
  render();
}

async function applyControlledReplan(preview: import('./core/planFact').ReplanPreview): Promise<void> {
  if (remoteReady() && remoteReplan) {
    if (preview.conflicts.length > 0) return;
    const changes = preview.affected.map(item => {
      const task = state.tasks.find(candidate => candidate.id === item.taskId);
      return task ? { taskId: task.id, proposedStart: item.newStart, proposedEnd: item.newEnd, expectedVersion: task.version } : null;
    }).filter((change): change is { taskId: string; proposedStart: string; proposedEnd: string; expectedVersion: number } => Boolean(change));
    if (changes.length === 0) return;
    const plan = await remoteReplan.apply(state.plan.id, state.plan.version, changes);
    applyApprovedReplan(state.tasks, preview);
    state.plan = plan;
    saveState(state);
    render();
    return;
  }
  applyApprovedReplan(state.tasks, preview); state.plan.version += 1; state.plan.status = 'DRAFT'; saveState(state); render();
}
function showError(error: unknown): void { window.alert(error instanceof Error ? error.message : 'Операция не выполнена'); }

function onMaintenanceChanged(): void { saveState(state); calculate(); render(); }

function mergeRemoteTask(remote: ProductionTask): void {
  const local = state.tasks.find(task => task.id === remote.id);
  if (!local) { state.tasks.push(remote); return; }
  Object.assign(local, remote);
}

async function assignEmployee(taskId: string, employeeId: string): Promise<void> {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return;
  if (remoteReady() && remotePlanning) {
    try {
      const remoteTask = await remotePlanning.assignTask(taskId, { employeeIds: employeeId ? [employeeId] : [] }, task.version);
      mergeRemoteTask(remoteTask);
      saveState(state);
      render();
    } catch (error) { showError(error); }
    return;
  }
  task.assignedEmployeeIds = employeeId ? [employeeId] : [];
  task.version += 1;
  saveState(state);
  render();
}

async function assignEquipment(taskId: string, equipmentId: string): Promise<void> {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return;
  if (remoteReady() && remotePlanning) {
    try {
      const remoteTask = await remotePlanning.assignTask(taskId, { equipmentIds: equipmentId ? [equipmentId] : [] }, task.version);
      mergeRemoteTask(remoteTask);
      saveState(state);
      render();
    } catch (error) { showError(error); }
    return;
  }
  task.assignedEquipmentIds = equipmentId ? [equipmentId] : [];
  task.version += 1;
  saveState(state);
  render();
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
    const remoteTask = await remoteExecution!.getTask(taskId);
    mergeRemoteTask(remoteTask);
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
  const conflicts = state.tasks.filter(task => state.tasks.some(other => other.id !== task.id && new Date(task.plannedStart).getTime() < new Date(other.plannedEnd).getTime() && new Date(other.plannedStart).getTime() < new Date(task.plannedEnd).getTime()));

  const dispatchOptions = {
    tasks: state.tasks,
    employees: state.employees,
    equipment: state.equipment,
    shifts: state.shifts,
    calendar: state.calendar,
    equipmentBlocks: state.equipmentBlocks,
    operations,
    onMove: moveTask,
    onAssignEmployee: assignEmployee,
    onAssignEquipment: assignEquipment
  };

  root.innerHTML = `${authHtml()}<header><h1>MES — оперативное управление производством</h1><div class="subtitle">1–30 дней · План/Факт · исполнение · простой · ТО · перепланирование</div></header><section class="kpis"><div class="kpi"><span>Операции</span><strong>${operations.length}</strong></div><div class="kpi"><span>Задания</span><strong>${state.tasks.length}</strong></div><div class="kpi"><span>Выпущено</span><strong>${totalGood}</strong></div><div class="kpi"><span>Открытые простои</span><strong>${openDowntime}</strong></div><div class="kpi"><span>Конфликты</span><strong>${conflicts.length}</strong></div></section>${renderDispatchBoard(dispatchOptions)}${renderCalendarEditor({ calendar: state.calendar, shifts: state.shifts, employees: state.employees, employeeSchedules: state.employeeSchedules, equipment: state.equipment, equipmentBlocks: state.equipmentBlocks, onCalendarChange: updateCalendarDay, onEmployeeScheduleChange: updateEmployeeSchedule, onAddBlock: addEquipmentBlock, onRemoveBlock: removeEquipmentBlock })}${renderExecutionPanel({ tasks: state.tasks, employees: state.employees, equipment: state.equipment, results: state.results, downtimes: state.downtimes, onAction: handleAction, onResult: handleResult, onDowntimeStart: handleDowntimeStart, onDowntimeEnd: handleDowntimeEnd })}${renderMaintenancePanel({ state, actorId: currentActorId(), onChanged: onMaintenanceChanged, onError: showError })}${renderPlanFactPanel({ orders: state.orders, tasks: state.tasks, results: state.results, downtimes: state.downtimes, now: new Date() })}${renderReplanPanel({ tasks: state.tasks, downtimes: state.downtimes, plan: state.plan, onApply: applyControlledReplan })}${renderIntegrationPanel({ store: integrationStore, onRefresh: () => render() })}`;

  bindCalendarEditor(root, { calendar: state.calendar, shifts: state.shifts, employees: state.employees, employeeSchedules: state.employeeSchedules, equipment: state.equipment, equipmentBlocks: state.equipmentBlocks, onCalendarChange: updateCalendarDay, onEmployeeScheduleChange: updateEmployeeSchedule, onAddBlock: addEquipmentBlock, onRemoveBlock: removeEquipmentBlock });
  bindExecutionPanel(root, { tasks: state.tasks, employees: state.employees, equipment: state.equipment, results: state.results, downtimes: state.downtimes, onAction: handleAction, onResult: handleResult, onDowntimeStart: handleDowntimeStart, onDowntimeEnd: handleDowntimeEnd });
  bindMaintenancePanel(root, { state, actorId: currentActorId(), onChanged: onMaintenanceChanged, onError: showError });
  bindReplanPanel(root, { tasks: state.tasks, downtimes: state.downtimes, plan: state.plan, onApply: applyControlledReplan });
  bindIntegrationPanel(root, { store: integrationStore, onRefresh: () => render() });

  const loginForm = root.querySelector<HTMLFormElement>('#login-form');
  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(loginForm);
    try { await signInMes(supabase, String(form.get('email') ?? ''), String(form.get('password') ?? '')); } catch (error) { showError(error); }
  });
  root.querySelector<HTMLButtonElement>('#signout')?.addEventListener('click', () => { if (supabase) void signOutMes(supabase).catch(showError); });
}

if (supabase) {
  authUnsubscribe = subscribeMesAuth(supabase, async () => {
    authState = await getMesAuthState(supabase);
    render();
  });
  void getMesAuthState(supabase).then(result => { authState = result; render(); }).catch(showError);
} else {
  render();
}

window.addEventListener('beforeunload', () => { authUnsubscribe?.(); });
