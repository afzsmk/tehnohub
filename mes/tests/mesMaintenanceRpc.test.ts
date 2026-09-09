import { describe, expect, it } from 'vitest';
import { SupabaseMesMaintenanceRpc } from '../src/integration/mesMaintenanceRpc';

function fakeClient(response: unknown, error: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error };
    }
  } as never;
}

const order = {
  id: 'MO-42',
  equipmentId: 'EQ-001',
  type: 'PM' as const,
  plannedStart: '2026-09-10T08:00:00.000Z',
  plannedEnd: '2026-09-10T10:00:00.000Z',
  status: 'PLANNED' as const,
  comment: 'Плановое ТО'
};

describe('Supabase MES maintenance RPC', () => {
  it('serializes maintenance creation', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesMaintenanceRpc(fakeClient({
      id: order.id,
      equipment_id: order.equipmentId,
      type: order.type,
      planned_start: order.plannedStart,
      planned_end: order.plannedEnd,
      status: order.status,
      comment: order.comment
    }, null, (name, args) => { called = { name, args }; }));

    await expect(rpc.createOrder(order.equipmentId, order.type, order.plannedStart, order.plannedEnd, order.comment)).resolves.toEqual(order);
    expect(called?.name).toBe('mes_create_maintenance_order');
    expect(called?.args).toEqual({
      p_equipment_id: order.equipmentId,
      p_type: order.type,
      p_planned_start: order.plannedStart,
      p_planned_end: order.plannedEnd,
      p_comment: order.comment
    });
  });

  it('serializes maintenance status changes', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesMaintenanceRpc(fakeClient({
      id: order.id,
      equipment_id: order.equipmentId,
      type: order.type,
      planned_start: order.plannedStart,
      planned_end: order.plannedEnd,
      status: 'IN_PROGRESS',
      comment: order.comment
    }, null, (name, args) => { called = { name, args }; }));

    await rpc.changeStatus(order.id, 'START');
    expect(called?.name).toBe('mes_change_maintenance_status');
    expect(called?.args).toEqual({ p_order_id: order.id, p_next_status: 'IN_PROGRESS' });
  });

  it('propagates RPC errors', async () => {
    const rpc = new SupabaseMesMaintenanceRpc(fakeClient(null, new Error('permission denied')));
    await expect(rpc.createOrder(order.equipmentId, order.type, order.plannedStart, order.plannedEnd)).rejects.toThrow('permission denied');
  });
});
