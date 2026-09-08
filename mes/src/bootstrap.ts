import { getMesAuthState } from './integration/auth';
import { SupabaseMesPlanningRpc } from './integration/mesPlanningRpc';
import { getMesSupabaseClient } from './services/supabase';

const supabase = getMesSupabaseClient();
const assignmentQueues = new Map<string, Promise<void>>();

function enqueueAssignment(taskId: string, job: () => Promise<void>): void {
  const previous = assignmentQueues.get(taskId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(job);
  assignmentQueues.set(taskId, next);
  void next.finally(() => {
    if (assignmentQueues.get(taskId) === next) assignmentQueues.delete(taskId);
  });
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

  enqueueAssignment(taskId, async () => {
    const auth = await getMesAuthState(supabase);
    if (!auth.identity) return;

    const rpc = new SupabaseMesPlanningRpc(supabase);
    await rpc.assignTask(
      taskId,
      isEmployee
        ? { employeeIds: [value], equipmentIds: undefined }
        : { employeeIds: undefined, equipmentIds: [value] },
      expectedVersion
    );
  });
}, true);

void import('./main');
