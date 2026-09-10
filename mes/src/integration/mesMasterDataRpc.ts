import type { SupabaseClient } from '@supabase/supabase-js';

export interface MasterProduct { id:string; code:string; name:string; unit:string; external_id?:string|null; }
export interface MasterEmployee { id:string; personnel_no:string; name:string; profession:string; qualification_level:number; active:boolean; }
export interface MasterEquipment { id:string; code:string; name:string; work_center:string; capabilities:string[]; active:boolean; }
export interface MasterShift { id:string; name:string; start_minute:number; duration_minutes:number; active:boolean; }

export interface BootstrapPayload {
  products?: MasterProduct[];
  employees?: MasterEmployee[];
  equipment?: MasterEquipment[];
  shifts?: MasterShift[];
  route_operations?: Record<string, unknown>[];
  calendar_days?: Record<string, unknown>[];
  employee_schedules?: Record<string, unknown>[];
}

export class SupabaseMesMasterDataRpc {
  constructor(private readonly client: SupabaseClient) {}

  private async call(name:string, args:Record<string,unknown>):Promise<unknown> {
    const { data, error } = await this.client.rpc(name,args);
    if (error) throw error;
    return data;
  }

  saveProduct(value:MasterProduct):Promise<unknown> { return this.call('mes_master_save_product',{p_id:value.id,p_code:value.code,p_name:value.name,p_unit:value.unit,p_external_id:value.external_id??null}); }
  saveEmployee(value:MasterEmployee):Promise<unknown> { return this.call('mes_master_save_employee',{p_id:value.id,p_personnel_no:value.personnel_no,p_name:value.name,p_profession:value.profession,p_qualification_level:value.qualification_level,p_active:value.active}); }
  saveEquipment(value:MasterEquipment):Promise<unknown> { return this.call('mes_master_save_equipment',{p_id:value.id,p_code:value.code,p_name:value.name,p_work_center:value.work_center,p_capabilities:value.capabilities,p_active:value.active}); }
  saveShift(value:MasterShift):Promise<unknown> { return this.call('mes_master_save_shift',{p_id:value.id,p_name:value.name,p_start_minute:value.start_minute,p_duration_minutes:value.duration_minutes,p_active:value.active}); }
  async importBootstrap(sourceName:string,payload:BootstrapPayload):Promise<Record<string,unknown>> {
    const data=await this.call('mes_import_bootstrap',{p_source_name:sourceName,p_payload:payload});
    if(!data||typeof data!=='object'||Array.isArray(data)) throw new Error('MES импорт вернул некорректный результат');
    return data as Record<string,unknown>;
  }
}
