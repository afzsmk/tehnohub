import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProductionRequestItemInput { productId:string; quantity:number; }
export interface ProductionRequestInput { id:string; requestNumber:string; objectName:string; desiredDate:string; items:ProductionRequestItemInput[]; }

export class SupabaseMesProductionRequestRpc {
  constructor(private readonly client:SupabaseClient){}
  async create(input:ProductionRequestInput):Promise<Record<string,unknown>>{
    const { data, error } = await this.client.rpc('mes_create_production_request',{
      p_id:input.id,p_request_number:input.requestNumber,p_object_name:input.objectName,p_desired_date:input.desiredDate,
      p_items:input.items.map((item)=>({product_id:item.productId,quantity:item.quantity}))
    });
    if(error) throw error;
    if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('MES RPC создания заявки вернула некорректный результат');
    return data as Record<string,unknown>;
  }
}
