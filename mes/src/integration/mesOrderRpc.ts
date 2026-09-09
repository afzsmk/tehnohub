import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionOrder } from '../types';

export type MesOrderStatus = ProductionOrder['status'];

interface DbOrder {
  id: string;
  external_id: string | null;
  number: string;
  product_id: string;
  quantity: number;
  completed_quantity: number;
  due_at: string;
  priority: ProductionOrder['priority'];
  status: MesOrderStatus;
}

function requireOrder(data: unknown): DbOrder {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('MES RPC mes_change_order_status вернул пустой результат');
  }
  return data as DbOrder;
}

export class SupabaseMesOrderRpc {
  constructor(private readonly client: SupabaseClient) {}

  async changeStatus(orderId: string, nextStatus: MesOrderStatus): Promise<ProductionOrder> {
    const { data, error } = await this.client.rpc('mes_change_order_status', {
      p_order_id: orderId,
      p_next_status: nextStatus
    });
    if (error) throw error;
    const row = requireOrder(data);
    return {
      id: row.id,
      externalId: row.external_id ?? undefined,
      number: row.number,
      productId: row.product_id,
      quantity: Number(row.quantity),
      completedQuantity: Number(row.completed_quantity),
      dueAt: row.due_at,
      priority: row.priority,
      status: row.status,
      route: []
    };
  }

  async planOrder(orderId: string): Promise<{ orderId: string; createdTasks: number; existingTasks: number; status: 'PLANNED' }> {
    const { data, error } = await this.client.rpc('mes_plan_order', { p_order_id: orderId });
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('MES RPC mes_plan_order вернул пустой результат');
    }
    const row = data as Record<string, unknown>;
    return {
      orderId: String(row.orderId ?? orderId),
      createdTasks: Number(row.createdTasks ?? 0),
      existingTasks: Number(row.existingTasks ?? 0),
      status: 'PLANNED'
    };
  }
}
