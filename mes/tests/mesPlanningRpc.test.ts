import { describe, expect, it } from 'vitest';
import { SupabaseMesPlanningRpc } from '../src/integration/mesPlanningRpc';

function fakeClient(response: unknown, responseError: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error: responseError };
    }
  } as never;
}

const dbTask = {
  id: 'TASK-1', order_id: 'ORDER-1', operation_id: 'OP-1', operation_sequence: 10,
  status: 'ASSIGNED', planned_start: '2026-09-08T08:00:00.000Z', planned_end: '2026-09-08T10:00:00.000Z',
  actual_start: null, actual_end: null, planned_quantity: 100, actual_quantity: 0, version: 4
};

describe('Supabase MES planning RPC', () => {
  it('sends partial employee assignment without clearing equipment', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesPlanningRpc(fakeClient(dbTask, null, (name, args) => { called = { name, args }; }));

    const task = await rpc.assignTask('TASK-1', { employeeIds: ['E-1', 'E-1'] }, 3);

    expect(called?.name).toBe('mes_assign_task');
    expect(called?.args).toMatchObject({
      p_task_id: 'TASK-1',
      p_employee_ids: ['E-1'],
      p_equipment_ids: null,
      p_expected_version: 3
    });
    expect(task.assignedEmployeeIds).toEqual(['E-1']);
    expect(task.assignedEquipmentIds).toEqual([]);
    expect(task.version).toBe(4);
  });

  it('propagates RPC errors', async () => {
    const rpc = new SupabaseMesPlanningRpc(fakeClient(null, new Error('permission denied')));
    await expect(rpc.assignTask('TASK-1', { equipmentIds: ['EQ-1'] }, 1)).rejects.toThrow('permission denied');
  });
});
