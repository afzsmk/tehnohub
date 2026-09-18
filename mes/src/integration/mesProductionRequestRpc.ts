import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProductionRequestItemInput { productId:string; quantity:number; }
export interface ProductionRequestInput { id:string; requestNumber:string; objectName:string; desiredDate:string; items:ProductionRequestItemInput[]; }
export interface ProductionOrderFromRequestInput {
  requestItemId:string;
  orderId:string;
  orderNumber:string;
  planId:string;
  dueAt:string;
  priority:'LOW'|'NORMAL'|'HIGH'|'URGENT';
}
export interface ProductionRequestFormationInput {
  requestId:string;
  planId:string;
  priority:'LOW'|'NORMAL'|'HIGH'|'URGENT';
  dueAt?:string|null;
}

function formatRpcError(error:unknown):string {
  if(error && typeof error==='object'){
    const row=error as Record<string,unknown>;
    const message=typeof row.message==='string'?row.message:'';
    const details=typeof row.details==='string'?row.details:'';
    const hint=typeof row.hint==='string'?row.hint:'';
    return [message,details,hint].filter(Boolean).join(' · ')||'Ошибка MES RPC';
  }
  return String(error);
}

export class SupabaseMesProductionRequestRpc {
  constructor(private readonly client:SupabaseClient){}
  async create(input:ProductionRequestInput):Promise<Record<string,unknown>>{
    const {data,error}=await this.client.rpc('mes_create_production_request',{
      p_id:input.id,p_request_number:input.requestNumber,p_object_name:input.objectName,p_desired_date:input.desiredDate,
      p_items:input.items.map(item=>({product_id:item.productId,quantity:item.quantity}))
    });
    if(error) throw new Error(formatRpcError(error));
    if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('MES RPC создания заявки вернула некорректный результат');
    return data as Record<string,unknown>;
  }

  async checkFeasibility(input:{requestId:string;planId:string;dueAt?:string|null}):Promise<Record<string,unknown>>{
    const {data,error}=await this.client.rpc('mes_check_production_request_feasibility',{
      p_request_id:input.requestId,p_plan_id:input.planId,p_due_at:input.dueAt??null
    });
    if(error)throw error;
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES RPC проверки выполнимости вернул пустой результат');
    return data as Record<string,unknown>;
  }

  async update(input:ProductionRequestInput):Promise<Record<string,unknown>>{
    const {data,error}=await this.client.rpc('mes_update_production_request',{
      p_id:input.id,p_request_number:input.requestNumber,p_object_name:input.objectName,
      p_desired_date:input.desiredDate,p_items:input.items.map(item=>({product_id:item.productId,quantity:item.quantity}))
    });
    if(error)throw error;
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES RPC изменения заявки вернул пустой результат');
    return data as Record<string,unknown>;
  }

  async cancel(requestId:string):Promise<Record<string,unknown>>{
    const {data,error}=await this.client.rpc('mes_cancel_production_request',{p_id:requestId});
    if(error)throw error;
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES RPC отмены заявки вернул пустой результат');
    return data as Record<string,unknown>;
  }

  async createOrderFromItem(input:ProductionOrderFromRequestInput):Promise<Record<string,unknown>>{
    const {data,error}=await this.client.rpc('mes_create_production_order_from_request_item',{
      p_request_item_id:input.requestItemId,p_order_id:input.orderId,p_order_number:input.orderNumber,
      p_plan_id:input.planId,p_due_at:input.dueAt,p_priority:input.priority
    });
    if(error) throw new Error(formatRpcError(error));
    if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('MES RPC создания производственного заказа вернула некорректный результат');
    return data as Record<string,unknown>;
  }
  async createOrdersFromRequest(input:ProductionRequestFormationInput):Promise<Record<string,unknown>>{
    const {data,error}=await this.client.rpc('mes_create_production_orders_from_request',{
      p_request_id:input.requestId,p_plan_id:input.planId,p_priority:input.priority,p_due_at:input.dueAt??null
    });
    if(error) throw new Error(formatRpcError(error));
    if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('MES RPC формирования производства вернула некорректный результат');
    return data as Record<string,unknown>;
  }
}
