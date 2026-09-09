import { getMesAuthState } from './integration/auth';
import { SupabaseMesPlanningRpc } from './integration/mesPlanningRpc';
import { SupabaseMesReplanRpc, MesReplanChange } from './integration/mesReplanRpc';
import { mountRouteEditor } from './ui/routeEditor';
import { mountQualityPage } from './ui/qualityPage';
import { mountMesDashboardPage } from './ui/mesDashboardPage';
import { mountOrdersPage } from './ui/ordersPage';
import { mountEventJournalPage } from './ui/eventJournalPage';
import { mountIntegrityPage } from './ui/integrityPage';
import { mountOperationalWorkflowPage } from './ui/operationalWorkflowPage';
import { mountWorkflowMonitorPage } from './ui/workflowMonitorPage';
import { mountProductionEntryPage } from './ui/productionEntryPage';
import { mountEquipmentOperationsPage } from './ui/equipmentOperationsPage';
import { mountDispatchGanttPage } from './ui/dispatchGanttPage';
import { subscribeMesRealtime } from './integration/mesRealtime';
import { getMesSupabaseClient } from './services/supabase';

const supabase = getMesSupabaseClient();
const assignmentQueues = new Map<string, Promise<void>>();
const replanQueues = new Map<string, Promise<void>>();
const prepareQueues = new Map<string, Promise<void>>();
const assignmentVersions = new Map<string, number>();

function reportRemoteFailure(error: unknown): void {
  window.alert(error instanceof Error ? error.message : 'Серверная операция MES не выполнена');
  window.location.reload();
}

function enqueue(queues: Map<string, Promise<void>>, key: string, job: () => Promise<void>): void {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(job).catch(reportRemoteFailure);
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}

document.addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !supabase) return;
  const employeeTaskId = target.dataset.employee;
  const equipmentTaskId = target.dataset.equipment;
  const taskId = employeeTaskId ?? equipmentTaskId;
  if (!taskId) return;
  const domVersion = Number(target.dataset.version);
  if (!Number.isInteger(domVersion) || domVersion <= 0) return;
  const isEmployee = Boolean(employeeTaskId);
  const value = target.value;
  if (!assignmentVersions.has(taskId)) assignmentVersions.set(taskId, domVersion);
  enqueue(assignmentQueues, taskId, async () => {
    const auth = await getMesAuthState(supabase);
    if (!auth.identity) return;
    const expectedVersion = assignmentVersions.get(taskId) ?? domVersion;
    await new SupabaseMesPlanningRpc(supabase).assignTask(
      taskId,
      isEmployee ? { employeeIds: value ? [value] : [] } : { equipmentIds: value ? [value] : [] },
      expectedVersion
    );
    assignmentVersions.set(taskId, expectedVersion + 1);
  });
}, true);

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !supabase) return;
  if (target.dataset.action === 'PREPARE') {
    const taskId = target.dataset.task;
    if (!taskId) return;
    event.stopImmediatePropagation();
    enqueue(prepareQueues, taskId, async () => {
      const auth = await getMesAuthState(supabase);
      if (!auth.identity) return;
      await new SupabaseMesPlanningRpc(supabase).prepareTask(taskId);
      window.location.reload();
    });
    return;
  }
  if (target.id !== 'replan-apply') return;
  const planId = target.dataset.planId;
  const planVersion = Number(target.dataset.planVersion);
  const encoded = target.dataset.changes;
  if (!planId || !Number.isInteger(planVersion) || planVersion <= 0 || !encoded) return;
  let changes: MesReplanChange[];
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as MesReplanChange[];
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    changes = parsed;
  } catch {
    reportRemoteFailure(new Error('Не удалось подготовить данные перепланирования'));
    return;
  }
  enqueue(replanQueues, planId, async () => {
    const auth = await getMesAuthState(supabase);
    if (!auth.identity) return;
    await new SupabaseMesReplanRpc(supabase).apply(planId, planVersion, changes);
    window.location.reload();
  });
});

void import('./main').then(async () => {
  if (!supabase) return;
  const auth = await getMesAuthState(supabase);
  if (!auth.identity) return;
  const app = document.querySelector<HTMLDivElement>('#app') ?? document.body;
  await mountMesDashboardPage(app, supabase);
  await mountOperationalWorkflowPage(app, supabase);
  await mountProductionEntryPage(app, supabase);
  await mountEquipmentOperationsPage(app, supabase);
  await mountDispatchGanttPage(app, supabase);
  await mountOrdersPage(app, supabase);
  await mountQualityPage(app, supabase);
  await mountEventJournalPage(app, supabase);
  await mountIntegrityPage(app, supabase);
  await mountWorkflowMonitorPage(app, supabase);
  await mountRouteEditor(app, supabase);
  subscribeMesRealtime(supabase, {
    tables: [
      'production_orders','production_tasks','task_assignments','production_results',
      'quality_inspections','downtime_events','maintenance_orders','equipment_blocks','production_events'
    ],
    onChange: () => window.dispatchEvent(new CustomEvent('mes-realtime-update'))
  });
}).catch(reportRemoteFailure);
