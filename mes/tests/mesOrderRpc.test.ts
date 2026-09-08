import { describe, expect, it } from 'vitest';
import { SupabaseMesOrderRpc } from '../src/integration/mesOrderRpc';

function fakeClient(response: unknown, responseError: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error: responseError };
    }
  } as never;
}

const dbOrder = {
  id: 'O-001',
  external_id: 'WF-O-001',
  number: 'ЗК-1001',
  product_id: 'P-001',
  quantity: 120,
  completed_quantity: 0,
  due_at: '2026-09-13T23:59:59.000Z',
  priority: 'URGENT',
  status: 'RELEASED'
};

describe('Supabase MES order RPC', () => {
  it('changes order status through the server RPC', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesOrderRpc(fakeClient(dbOrder, null, (name, args) => { called = { name, args }; }));

    const order = await rpc.changeStatus('O-001', 'RELEASED');

    expect(called?.name).toBe('mes_change_order_status');
    expect(called?.args).toEqual({ p_order_id: 'O-001', p_next_status: 'RELEASED' });
    expect(order.id).toBe('O-001');
    expect(order.status).toBe('RELEASED');
    expect(order.route).toEqual([]);
  });

  it('plans an order and returns created-task count', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesOrderRpc(fakeClient(
      { orderId: 'O-001', createdTasks: 2, existingTasks: 0, status: 'PLANNED' },
      null,
      (name, args) => { called = { name, args }; }
    ));

    await expect(rpc.planOrder('O-001')).resolves.toEqual({
      orderId: 'O-001',
      createdTasks: 2,
      existingTasks: 0,
      status: 'PLANNED'
    });
    expect(called).toEqual({ name: 'mes_plan_order', args: { p_order_id: 'O-001' } });
  });

  it('propagates server validation errors', async () => {
    const rpc = new SupabaseMesOrderRpc(fakeClient(null, new Error('Нельзя планировать заказ без активного технологического маршрута')));
    await expect(rpc.changeStatus('O-001', 'PLANNED')).rejects.toThrow('активного технологического маршрута');
  });
});
