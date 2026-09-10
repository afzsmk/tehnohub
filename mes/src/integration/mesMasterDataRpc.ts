import type { SupabaseClient } from '@supabase/supabase-js';

export interface MasterProduct { id:string; code:string; name:string; unit:string; external_id?:string|null; }
export interface MasterEmployee { id:string; personnel_no:string; name:string; profession:string; qualification_level:number; active:boolean; }
export interface MasterEquipment { id:string; code:string; name:string; work_center:string; capabilities:string[]; active:boolean; }
export interface MasterShift { id:string; name:string; start_minute:number; duration_minutes:number; active:boolean; }
export interface BootstrapPayload { products?:MasterProduct[]; employees?:MasterEmployee[]; equipment?:MasterEquipment[]; shifts?:MasterShift[]; route_operations?:Record<string,unknown>[]; calendar_days?:Record<string,unknown>[]; employee_schedules?:Record<string,unknown>[]; }
export interface BootstrapValidation { valid:boolean; errors:string[]; warnings:string[]; }

export class SupabaseMesMasterDataRpc {
  constructor(private readonly client:SupabaseClient){}
  private async call(name:string,args:Record<string,unknown>):Promise<unknown>{const{data,error}=await this.client.rpc(name,args);if(error)throw error;return data;}
  saveProduct(v:MasterProduct):Promise<unknown>{return this.call('mes_master_save_product',{p_id:v.id,p_code:v.code,p_name:v.name,p_unit:v.unit,p_external_id:v.external_id??null});}
  saveEmployee(v:MasterEmployee):Promise<unknown>{return this.call('mes_master_save_employee',{p_id:v.id,p_personnel_no:v.personnel_no,p_name:v.name,p_profession:v.profession,p_qualification_level:v.qualification_level,p_active:v.active});}
  saveEquipment(v:MasterEquipment):Promise<unknown>{return this.call('mes_master_save_equipment',{p_id:v.id,p_code:v.code,p_name:v.name,p_work_center:v.work_center,p_capabilities:v.capabilities,p_active:v.active});}
  saveShift(v:MasterShift):Promise<unknown>{return this.call('mes_master_save_shift',{p_id:v.id,p_name:v.name,p_start_minute:v.start_minute,p_duration_minutes:v.duration_minutes,p_active:v.active});}
  async validateBootstrap(payload:BootstrapPayload):Promise<BootstrapValidation>{const data=await this.call('mes_validate_bootstrap',{p_payload:payload});if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES validation вернула некорректный результат');const x=data as Record<string,unknown>;return{valid:Boolean(x.valid),errors:Array.isArray(x.errors)?x.errors.map(String):[],warnings:Array.isArray(x.warnings)?x.warnings.map(String):[]};}
  async importBootstrap(sourceName:string,payload:BootstrapPayload):Promise<Record<string,unknown>>{const data=await this.call('mes_import_bootstrap',{p_source_name:sourceName,p_payload:payload});if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES импорт вернул некорректный результат');return data as Record<string,unknown>;}
}
