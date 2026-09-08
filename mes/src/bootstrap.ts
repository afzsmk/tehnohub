import { getMesAuthState } from './integration/auth';
import { SupabaseMesPlanningRpc } from './integration/mesPlanningRpc';
import { SupabaseMesReplanRpc, MesReplanChange } from './integration/mesReplanRpc';
import { getMesSupabaseClient } from './services/supabase';

const supabase = getMesSupabaseClient();
const assignmentQueues = new Map<string, Promise<void>>();
const replanQueues = new Map<string, Promise<void>>();

function enqueue<T>(queues: Map<string, Promise<void>>, key: string, job: () => Promise<T>): void {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => { await job(); });
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}

function reportRemoteFailure(error: unknown): void {
  window.alert(error instanceof Error ? error.message : 'Серверная операция MES не выполнена');
  window.location.reload();
}

document.addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !supabase) return;

  const employeeTaskId = target.dataset.employee;
  const equipmentTaskId = target.dataset.equipment;
  const taskId = employeeTaskId ?? equipmentTaskId;
  if (!taskId) return;

  const expectedVersion = Number(target.dataset.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) return;

  const isEmployee = Boolean(employeeTaskId);
  const value = target.value;

  enqueue(assignmentQueues, taskId, async () => {
    const auth = await getMesAuthState(supabase);
    if (!auth.identity) return;
    const rpc = new SupabaseMesPlanningRpc(supabase);
    await rpc.assignTask(
      taskId,
      isEmployee ? { employeeIds: [value] } : { equipmentIds: [value] },
      expectedVersion
    );
  });
}, true);

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || target.id !== 'replan-apply' || !supabase) return;

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
    const rpc = new SupabaseMesReplanRpc(supabase);
    await rpc.apply(planId, planVersion, changes);
  });
}, true);

// The existing main module remains the UI/state coordinator. This bootstrap
// only adds server-side persistence guards before it is evaluated.
void import('./main');

window.addEventListener('unhandledrejection', event => {
  if (event.reason) reportRemoteFailure(event.reason);
});
