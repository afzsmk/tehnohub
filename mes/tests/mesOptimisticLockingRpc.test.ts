import { describe, expect, it } from 'vitest';
import { SupabaseMesMaintenanceRpc } from '../src/integration/mesMaintenanceRpc';
import { SupabaseMesOrderRpc } from '../src/integration/mesOrderRpc';

function fakeClient(response: unknown, error: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error };
    }
  } as never;
}

const order = {
  id: 'O-1',
  external_id: 'EXT-1',
  number: 'ZK-1',
  product_id: 'P-1',
  quantity: 100,
  completed_quantity: 40,
  due_at: '2026-09-20T00:00:00.000Z',
  priority: 'HIGH' as const,
  status: 'PARTIALLY_COMPLETED' as const
};

const maintenance = {
  id: 'M-1',
  equipment_id: 'EQ-1',
  type: 'PM' as const,
  planned_start: '2026-09-10T08:00:00.000Z',
  planned_end: '2026-09-10T10:00:00.000Z',
  status: 'PLANNED' as const,
  comment: 'ТО'
};

describe('MES optimistic locking RPC contracts', () => {
  it('sends observed order state as an optimistic precondition', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesOrderRpc(fakeClient(order, null, (name, args) => { called = { name, args }; }));

    await rpc.changeStatus(order.id, 'IN_EXECUTION', order.status, order.completed_quantity);

    expect(called).toEqual({
      name: 'mes_change_order_status',
      args: {
        p_order_id: order.id,
        p_next_status: 'IN_EXECUTION',
        p_expected_status: order.status,
        p_expected_completed_quantity: order.completed_quantity
      }
    });
  });

  it('sends observed maintenance status as an optimistic precondition', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesMaintenanceRpc(fakeClient(maintenance, null, (name, args) => { called = { name, args }; }));

    await rpc.changeStatus(maintenance.id, 'START', maintenance.status);

    expect(called).toEqual({
      name: 'mes_change_maintenance_status',
      args: {
        p_order_id: maintenance.id,
        p_next_status: 'IN_PROGRESS',
        p_expected_status: maintenance.status
      }
    });
  });

  it('propagates stale-writer errors from the server', async () => {
    const rpc = new SupabaseMesOrderRpc(fakeClient(null, new Error('Статус заказа устарел')));
    await expect(rpc.changeStatus(order.id, 'IN_EXECUTION', order.status, order.completed_quantity)).rejects.toThrow('устарел');
  });
});
