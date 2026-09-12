import type { SupabaseClient } from '@supabase/supabase-js';
import type { RouteOperation } from '../types';

interface DbRouteOperation {
  id:string; product_id:string; sequence:number; code:string; name:string; work_center:string;
  required_qualification:number|null; required_equipment_ids:unknown; setup_minutes:number; run_minutes_per_unit:number;
  active:boolean; labor_norm_hours_per_unit:number; setup_norm_hours:number; workers_required:number;
}

export interface NormalizedRouteOperationInput extends RouteOperation {
  productId:string;
  routeId:string;
  workCenterId:string;
  requiredQualificationId?:string|null;
  active?:boolean;
}

function mapRow(row:DbRouteOperation):RouteOperation {
  return {
    id:row.id, sequence:Number(row.sequence), code:row.code, name:row.name, workCenter:row.work_center,
    requiredQualification:row.required_qualification==null?undefined:Number(row.required_qualification),
    requiredEquipmentIds:Array.isArray(row.required_equipment_ids)?row.required_equipment_ids.filter((v):v is string=>typeof v==='string'):[],
    laborNormHoursPerUnit:Number(row.labor_norm_hours_per_unit), setupNormHours:Number(row.setup_norm_hours),
    workersRequired:Number(row.workers_required), setupMinutes:Number(row.setup_minutes), runMinutesPerUnit:Number(row.run_minutes_per_unit),
  };
}

export class SupabaseMesRouteRpc {
  constructor(private readonly client:SupabaseClient){}
  async save(operation:RouteOperation&{productId:string;active?:boolean}):Promise<RouteOperation>{
    const{data,error}=await this.client.rpc('mes_master_save_route_operation',{
      p_id:operation.id,p_product_id:operation.productId,p_sequence:operation.sequence,p_code:operation.code,
      p_name:operation.name,p_work_center:operation.workCenter,p_required_qualification:operation.requiredQualification??null,
      p_required_equipment_ids:operation.requiredEquipmentIds??[],p_setup_norm_hours:operation.setupNormHours??0,
      p_labor_norm_hours_per_unit:operation.laborNormHoursPerUnit??0,p_workers_required:operation.workersRequired??1,p_active:operation.active??true
    });
    if(error)throw error;if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES RPC mes_master_save_route_operation вернул пустой результат');
    return mapRow(data as DbRouteOperation);
  }
  async saveNormalized(operation:NormalizedRouteOperationInput):Promise<RouteOperation>{
    const{data,error}=await this.client.rpc('mes_master_save_route_operation_v2',{
      p_id:operation.id,p_route_id:operation.routeId,p_sequence:operation.sequence,p_code:operation.code,p_name:operation.name,
      p_work_center_id:operation.workCenterId,p_required_qualification_id:operation.requiredQualificationId??null,
      p_required_equipment_ids:operation.requiredEquipmentIds??[],p_setup_norm_hours:operation.setupNormHours??0,
      p_labor_norm_hours_per_unit:operation.laborNormHoursPerUnit??0,p_workers_required:operation.workersRequired??1,p_active:operation.active??true
    });
    if(error)throw error;if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES RPC mes_master_save_route_operation_v2 вернул пустой результат');
    return mapRow(data as DbRouteOperation);
  }
  async remove(operationId:string):Promise<void>{const{error}=await this.client.rpc('mes_delete_route_operation',{p_id:operationId});if(error)throw error;}
}
