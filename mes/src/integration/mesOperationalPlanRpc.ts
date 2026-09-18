import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperationalPlan } from '../types';

interface DbPlan {
  id:string; version:number; horizon_start:string; horizon_end:string;
  status:OperationalPlan['status']; source_plan_id:string|null; source_plan_version:number|null;
}

function mapPlan(value:unknown):OperationalPlan {
  if(Array.isArray(value)) {
    if(value.length!==1) throw new Error('MES RPC операционного плана вернул некорректный результат');
    value=value[0];
  }
  if(!value || typeof value!=='object') throw new Error('MES RPC операционного плана вернул некорректный результат');
  const row=value as Record<string,unknown>;
  return {
    id:String(row.id), version:Number(row.version), horizonStart:String(row.horizon_start),
    horizonEnd:String(row.horizon_end), status:row.status as OperationalPlan['status'],
    sourcePlanId:row.source_plan_id==null?undefined:String(row.source_plan_id),
    sourcePlanVersion:row.source_plan_version==null?undefined:Number(row.source_plan_version)
  };
}

export class SupabaseMesOperationalPlanRpc {
  constructor(private readonly client:SupabaseClient){}
  async create(id:string,horizonStart:string,horizonEnd:string):Promise<OperationalPlan>{
    const {data,error}=await this.client.rpc('mes_create_operational_plan',{p_id:id,p_horizon_start:horizonStart,p_horizon_end:horizonEnd});
    if(error) throw error;
    try{
      return mapPlan(data);
    }catch(parseError){
      const {data:row,error:readError}=await this.client
        .from('operational_plans')
        .select('id,version,horizon_start,horizon_end,status,source_plan_id,source_plan_version')
        .eq('id',id)
        .maybeSingle();
      if(!readError&&row)return mapPlan(row);
      throw parseError;
    }
  }
  async changeStatus(planId:string,nextStatus:OperationalPlan['status'],expectedVersion?:number):Promise<OperationalPlan>{
    const {data,error}=await this.client.rpc('mes_change_operational_plan_status',{
      p_plan_id:planId,p_next_status:nextStatus,p_expected_version:expectedVersion??null
    });
    if(error) throw error;
    return mapPlan(data);
  }
}
