import './styles.css';
import { buildDefaultCalendar } from './core/operationalCalendar';
import { buildDeterministicSchedule } from './core/scheduler';
import { executeTaskAction, recordProductionResult, startDowntime, endDowntime } from './core/execution';
import { buildPlanFactSummary } from './core/planFact';
import { createMaintenanceOrder, removeMaintenanceBlock, syncMaintenanceBlock, transitionMaintenance } from './core/maintenance';
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
import { SupabaseMesMaintenanceRpc } from './integration/mesMaintenanceRpc';
import { SupabaseMesRuntimeSnapshotRpc, MesRuntimeSnapshot } from './integration/mesRuntimeSnapshotRpc';
import { subscribeMesRealtime } from './integration/mesRealtime';
import { getMesSupabaseClient } from './services/supabase';
import { CalendarDay, EmployeeSchedule, MaintenanceOrder, MesState, ProductionTask } from './types';
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
const remoteMaintenance = supabase ? new SupabaseMesMaintenanceRpc(supabase) : null;
const remoteSnapshot = supabase ? new SupabaseMesRuntimeSnapshotRpc(supabase) : null;
let authState: MesAuthState = { user: null, identity: null };
let authUnsubscribe: (() => void) | null = null;
let realtimeUnsubscribe: (() => void) | null = null;
let calendarMutationChain: Promise<void> = Promise.resolve();
let remoteCalendarRevision: number | undefined;
let remoteHydrationPromise: Promise<void> | null = null;
let remoteHydrationRequested = false;
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения');
const root = app;

function currentActorId(): string { return authState.identity?.userId ?? 'demo-dispatcher'; }
function remoteReady(): boolean { return Boolean(remoteExecution && authState.identity); }
function remoteEquipmentBlocksReady(): boolean { return Boolean(remoteEquipmentBlocks && authState.identity); }
function remoteMaintenanceReady(): boolean { return Boolean(remoteMaintenance && authState.identity); }

async function hydrateRemoteState(): Promise<void> {
  if (!remoteSnapshot || !authState.identity) return;
  if (remoteHydrationPromise) {
    remoteHydrationRequested = true;
    await remoteHydrationPromise;
    return;
  }

  remoteHydrationPromise = (async () => {
    do {
      remoteHydrationRequested = false;
      const snapshot: MesRuntimeSnapshot = await remoteSnapshot.load(state.plan.id);
      remoteCalendarRevision = snapshot.calendarRevision;
      if (snapshot.plan) state.plan = snapshot.plan;
      state.products = snapshot.products ?? [];
      state.employees = snapshot.employees ?? [];
      state.equipment = snapshot.equipment ?? [];
      state.shifts = snapshot.shifts ?? [];
      state.calendar = snapshot.calendar ?? [];
      state.employeeSchedules = snapshot.employeeSchedules ?? [];
      state.equipmentBlocks = snapshot.equipmentBlocks ?? [];
      state.orders = snapshot.orders ?? [];
      state.tasks = snapshot.tasks ?? [];
      state.downtimes = snapshot.downtimes ?? [];
      state.maintenance = snapshot.maintenance ?? [];
      state.results = snapshot.results ?? [];
      state.qualityInspections = snapshot.qualityInspections ?? [];
      state.events = snapshot.events ?? [];
      saveState(state);
      render();
    } while (remoteHydrationRequested && authState.identity);
  })().finally(() => { remoteHydrationPromise = null; });

  await remoteHydrationPromise;
}

function startRealtime(): void {
  if (!supabase || !authState.identity || realtimeUnsubscribe) return;
  realtimeUnsubscribe = subscribeMesRealtime(supabase, {
    debounceMs: 350,
    onChange: () => { void hydrateRemoteState().catch(showError); }
  });
}

function stopRealtime(): void {
  realtimeUnsubscribe?.();
  realtimeUnsubscribe = null;
}

function enqueueCalendarMutation(mutator: (calendar: CalendarDay[], schedules: EmployeeSchedule[]) => void): Promise<void> {
  calendarMutationChain = calendarMutationChain
    .catch(() => undefined)
    .then(async () => {
      const nextCalendar = state.calendar.map(day => ({ ...day, shiftIds: [...day.shiftIds] }));
      const nextSchedules = state.employeeSchedules.map(schedule => ({ ...schedule, shiftIds: [...schedule.shiftIds] }));
      mutator(nextCalendar, nextSchedules);
      if (remoteCalendar && authState.identity) {
        if (remoteCalendarRevision === undefined) await hydrateRemoteState();
        const revision = await remoteCalendar.saveCalendar(nextCalendar, nextSchedules, remoteCalendarRevision ?? 1);
        remoteCalendarRevision = revision;
        await hydrateRemoteState();
        return;
      }
      state.calendar = nextCalendar;
      state.employeeSchedules = nextSchedules;
      calculate();
      render();
    });
  return calendarMutationChain;
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
  if (remoteReady()) return;
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
    try {
      await remoteReplan.apply(state.plan.id, state.plan.version, [{ taskId: task.id, proposedStart: plannedStart, proposedEnd: plannedEnd, expectedVersion: task.version }]);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  updateTask(taskId, { plannedStart, plannedEnd });
}

function updateCalendarDay(date: string, isWorking: boolean, shiftIds: string[]): Promise<void> {
  return enqueueCalendarMutation((nextCalendar, nextSchedules) => {
    const day = nextCalendar.find(item => item.date === date);
    if (!day) return;
    day.isWorking = isWorking;
    day.shiftIds = isWorking ? [...shiftIds] : [];
    if (!isWorking) nextSchedules.filter(item => item.date === date).forEach(item => { item.status = 'OFF'; item.shiftIds = []; });
  });
}

function updateEmployeeSchedule(employeeId: string, date: string, status: EmployeeSchedule['status'], shiftIds: string[]): Promise<void> {
  return enqueueCalendarMutation((nextCalendar, nextSchedules) => {
    void nextCalendar;
    const item = nextSchedules.find(schedule => schedule.employeeId === employeeId && schedule.date === date);
    if (item) {
      item.status = status;
      item.shiftIds = [...shiftIds];
    } else nextSchedules.push({ employeeId, date, status, shiftIds: [...shiftIds] });
  });
}

async function addEquipmentBlock(block: Omit<import('./types').EquipmentBlock, 'id'>): Promise<void> {
  if (remoteEquipmentBlocksReady()) {
    try {
      await remoteEquipmentBlocks!.createBlock(block);
      await hydrateRemoteState();
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
      await remoteEquipmentBlocks!.deleteBlock(blockId);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  state.equipmentBlocks = state.equipmentBlocks.filter(b => b.id !== blockId);
  calculate();
  render();
}

async function createMaintenance(input: Omit<MaintenanceOrder, 'id' | 'status'>): Promise<void> {
  if (remoteMaintenanceReady()) {
    try {
      await remoteMaintenance!.createOrder(input.equipmentId, input.type, input.plannedStart, input.plannedEnd, input.comment);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  const order = createMaintenanceOrder(input.equipmentId, input.type, input.plannedStart, input.plannedEnd, input.comment);
  state.maintenance.push(order);
  state.equipmentBlocks = syncMaintenanceBlock(state.maintenance, state.equipmentBlocks);
  saveState(state);
  render();
}

async function changeMaintenanceStatus(orderId: string, action: 'START' | 'COMPLETE' | 'CANCEL'): Promise<void> {
  if (remoteMaintenanceReady()) {
    const current = state.maintenance.find(item => item.id === orderId);
    try {
      await remoteMaintenance!.changeStatus(orderId, action, current?.status);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  const index = state.maintenance.findIndex(item => item.id === orderId);
  if (index < 0) return;
  const current = state.maintenance[index];
  state.maintenance[index] = transitionMaintenance(current, action);
  state.equipmentBlocks = syncMaintenanceBlock(state.maintenance, state.equipmentBlocks);
  saveState(state);
  render();
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  window.alert(message);
}

async function handleExecution(taskId: string, action: MesExecutionAction, actualQuantity?: number, comment?: string): Promise<void> {
  if (remoteReady()) {
    try {
      const current = state.tasks.find(t => t.id === taskId);
      await remoteExecution!.execute(taskId, action, current?.version, actualQuantity, comment);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  try {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const result = executeTaskAction(task, action, currentActorId(), actualQuantity, comment, state.orders);
    state.events.push(result.event);
    state.tasks = state.tasks.map(item => item.id === result.task.id ? result.task : item);
    if (result.order) state.orders = state.orders.map(item => item.id === result.order?.id ? result.order : item);
    if (result.result) state.results.push(result.result);
    calculate();
    render();
  } catch (error) { showError(error); }
}

async function handleProductionResult(taskId: string, goodQuantity: number, scrapQuantity: number, comment?: string): Promise<void> {
  if (remoteReady()) {
    try {
      const current = state.tasks.find(t => t.id === taskId);
      await remoteExecution!.recordResult(taskId, goodQuantity, scrapQuantity, current?.version, comment);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  try {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const result = recordProductionResult(task, goodQuantity, scrapQuantity, currentActorId(), comment, state.orders);
    state.events.push(result.event);
    state.tasks = state.tasks.map(item => item.id === result.task.id ? result.task : item);
    if (result.order) state.orders = state.orders.map(item => item.id === result.order?.id ? result.order : item);
    state.results.push(result.result);
    calculate();
    render();
  } catch (error) { showError(error); }
}

async function handleDowntimeStart(equipmentId: string, reasonCode: string, comment?: string): Promise<void> {
  if (remoteReady()) {
    try {
      await remoteExecution!.startDowntime(equipmentId, reasonCode, currentActorId(), comment);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  const result = startDowntime(state.downtimes, equipmentId, reasonCode, currentActorId(), comment);
  state.downtimes = result.downtimes;
  state.events.push(result.event);
  render();
}

async function handleDowntimeEnd(id: string, comment?: string): Promise<void> {
  if (remoteReady()) {
    try {
      await remoteExecution!.endDowntime(id, currentActorId(), comment);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  const result = endDowntime(state.downtimes, id, currentActorId(), comment);
  state.downtimes = result.downtimes;
  state.events.push(result.event);
  render();
}

async function applyReplan(input: Parameters<typeof applyApprovedReplan>[0]): Promise<void> {
  if (remoteReady() && remoteReplan) {
    try {
      await remoteReplan.apply(state.plan.id, state.plan.version, input.changes);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  applyApprovedReplan(state, input);
  saveState(state);
  render();
}

async function assignTask(taskId: string, employeeIds?: string[], equipmentIds?: string[]): Promise<void> {
  if (remoteReady() && remotePlanning) {
    try {
      const task = state.tasks.find(item => item.id === taskId);
      if (!task) return;
      await remotePlanning.assignTask(taskId, {
        employeeIds: employeeIds ?? null,
        equipmentIds: equipmentIds ?? null
      }, task.version);
      await hydrateRemoteState();
    } catch (error) { showError(error); }
    return;
  }
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return;
  task.assignedEmployeeIds = employeeIds ?? task.assignedEmployeeIds;
  task.assignedEquipmentIds = equipmentIds ?? task.assignedEquipmentIds;
  task.version += 1;
  saveState(state);
  render();
}

function render(): void {
  root.innerHTML = '';
  root.append(
    renderIntegrationPanel(authState, signInMes, signOutMes),
    renderCalendarEditor(state.calendar, state.employeeSchedules, state.shifts, updateCalendarDay, updateEmployeeSchedule),
    renderDispatchBoard(state, moveTask, assignTask),
    renderExecutionPanel(state, handleExecution, handleProductionResult, handleDowntimeStart, handleDowntimeEnd),
    renderMaintenancePanel(state, createMaintenance, changeMaintenanceStatus),
    renderReplanPanel(state, applyReplan),
    renderPlanFactPanel(buildPlanFactSummary(state))
  );
  bindCalendarEditor(root);
  bindIntegrationPanel(root);
  bindExecutionPanel(root);
  bindMaintenancePanel(root);
  bindReplanPanel(root);
}

async function bootstrapRemote(): Promise<void> {
  authState = await getMesAuthState();
  authUnsubscribe = subscribeMesAuth(next => {
    authState = next;
    if (next.identity) {
      void hydrateRemoteState().then(() => startRealtime()).catch(showError);
    } else {
      stopRealtime();
      remoteCalendarRevision = undefined;
    }
    render();
  });
  if (authState.identity) {
    await hydrateRemoteState();
    startRealtime();
  }
}

ensureHorizon();
calculate();
render();
void bootstrapRemote().catch(showError);
window.addEventListener('beforeunload', () => authUnsubscribe?.());
