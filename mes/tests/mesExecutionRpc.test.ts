import { describe, expect, it } from 'vitest';
import { SupabaseMesExecutionRpc } from '../src/integration/mesExecutionRpc';

const dbTask = {
  id: 'TASK-1', order_id: 'ORDER-1', operation_id: 'OP-1', operation_sequence: 10,
  status: 'RUNNING', planned_start: '2026-09-08T08:00:00.000Z', planned_end: '2026-09-08T10:00:00.000Z',
  actual_start: '2026-09-08T08:01:00.000Z', actual_end: null,
  planned_quantity: 100, actual_quantity: 20, version: 6
};

describe('Supabase MES execution RPC', () => {
  it('preserves assignments returned from the server after task action', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        called = { name, args };
        return { data: dbTask, error: null };
      },
      from: (table: string) => ({
        select: (_columns: string) => ({
          eq: (_column: string, _value: string) => Promise.resolve({
            data: table === 'task_assignments'
              ? [{ employee_id: 'E-1', equipment_id: 'M-1' }, { employee_id: 'E-1', equipment_id: null }]
              : [],
            error: null
          })
        })
      })
    } as never;

    const rpc = new SupabaseMesExecutionRpc(client);
    const task = await rpc.executeTaskAction('TASK-1', 'PAUSE', '2026-09-08T09:10:00.000Z');

    expect(called).toEqual({
      name: 'mes_execute_task_action',
      args: {
        p_task_id: 'TASK-1',
        p_action: 'PAUSE',
        p_occurred_at: '2026-09-08T09:10:00.000Z'
      }
    });
    expect(task.assignedEmployeeIds).toEqual(['E-1']);
    expect(task.assignedEquipmentIds).toEqual(['M-1']);
    expect(task.version).toBe(6);
  });

  it('propagates execution RPC errors', async () => {
    const client = {
      rpc: async () => ({ data: null, error: new Error('execution denied') })
    } as never;

    const rpc = new SupabaseMesExecutionRpc(client);
    await expect(rpc.executeTaskAction('TASK-1', 'START')).rejects.toThrow('execution denied');
  });
});
