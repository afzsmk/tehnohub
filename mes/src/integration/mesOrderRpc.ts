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

  async changeStatus(
    orderId: string,
    nextStatus: MesOrderStatus,
    expectedStatus?: MesOrderStatus,
    expectedCompletedQuantity?: number
  ): Promise<ProductionOrder> {
    const { data, error } = await this.client.rpc('mes_change_order_status', {
      p_order_id: orderId,
      p_next_status: nextStatus,
      p_expected_status: expectedStatus ?? null,
      p_expected_completed_quantity: expectedCompletedQuantity ?? null
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


  async revise(orderId:string,input:{planId:string;dueAt:string;priority:ProductionOrder['priority']}):Promise<ProductionOrder>{
    const {data,error}=await this.client.rpc('mes_revise_production_order',{
      p_order_id:orderId,p_plan_id:input.planId,p_due_at:input.dueAt,p_priority:input.priority
    });
    if(error)throw error;
    const row=requireOrder(data);
    return {
      id:row.id,externalId:row.external_id??undefined,number:row.number,productId:row.product_id,
      quantity:Number(row.quantity),completedQuantity:Number(row.completed_quantity),dueAt:row.due_at,
      priority:row.priority,status:row.status,route:[]
    };
  }

  async split(orderId:string,parts:Array<{quantity:number;dueAt:string;planId:string;priority:ProductionOrder['priority'];orderNumber?:string}>):Promise<Record<string,unknown>>{
    const {data,error}=await this.client.rpc('mes_split_production_order',{
      p_order_id:orderId,
      p_parts:parts.map(part=>({quantity:part.quantity,dueAt:part.dueAt,planId:part.planId,priority:part.priority,orderNumber:part.orderNumber??null}))
    });
    if(error)throw error;
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES RPC разбиения заказа вернул пустой результат');
    return data as Record<string,unknown>;
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
