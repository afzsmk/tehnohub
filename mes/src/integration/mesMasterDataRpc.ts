import type { SupabaseClient } from '@supabase/supabase-js';

export interface MasterProduct { id:string; code:string; name:string; unit:string; external_id?:string|null; }
export interface MasterProfession { id:string; external_id?:string|null; code:string; name:string; description?:string|null; active:boolean; }
export interface MasterQualification { id:string; external_id?:string|null; code:string; name:string; level:number; description?:string|null; active:boolean; }
export interface MasterBrigade { id:string; external_id?:string|null; code:string; name:string; description?:string|null; active:boolean; }
export interface MasterEmployee { id:string; personnel_no:string; name:string; profession:string; profession_id?:string|null; brigade_id?:string|null; qualification_id?:string|null; qualification_level:number; active:boolean; }
export interface MasterEmployeeQualification { employee_id:string; qualification_id:string; valid_from?:string|null; valid_to?:string|null; is_primary:boolean; notes?:string|null; }
export interface MasterWorkCenter { id:string; external_id?:string|null; code:string; name:string; site_code?:string|null; description?:string|null; active:boolean; }
export interface MasterEquipment { id:string; code:string; name:string; work_center:string; capabilities:string[]; active:boolean; }
export interface MasterRoute { id:string; external_id?:string|null; product_id:string; code:string; name:string; version:number; active:boolean; valid_from?:string|null; valid_to?:string|null; description?:string|null; }
export interface MasterShift { id:string; name:string; start_minute:number; duration_minutes:number; active:boolean; }
export interface BootstrapPayload { products?:MasterProduct[]; professions?:MasterProfession[]; qualification_levels?:MasterQualification[]; brigades?:MasterBrigade[]; employees?:MasterEmployee[]; employee_qualifications?:MasterEmployeeQualification[]; work_centers?:MasterWorkCenter[]; equipment?:MasterEquipment[]; routes?:MasterRoute[]; shifts?:MasterShift[]; route_operations?:Record<string,unknown>[]; calendar_days?:Record<string,unknown>[]; employee_schedules?:Record<string,unknown>[]; downtime_reasons?:Record<string,unknown>[]; scrap_reasons?:Record<string,unknown>[]; }
export interface BootstrapValidation { valid:boolean; errors:string[]; warnings:string[]; }

export class SupabaseMesMasterDataRpc {
  constructor(private readonly client:SupabaseClient){}
  private async call(name:string,args:Record<string,unknown>):Promise<unknown>{const{data,error}=await this.client.rpc(name,args);if(error)throw error;return data;}
  saveProduct(v:MasterProduct):Promise<unknown>{return this.call('mes_master_save_product',{p_id:v.id,p_code:v.code,p_name:v.name,p_unit:v.unit,p_external_id:v.external_id??null});}
  saveEmployee(v:MasterEmployee):Promise<unknown>{return this.call('mes_master_save_employee',{p_id:v.id,p_personnel_no:v.personnel_no,p_name:v.name,p_profession:v.profession,p_qualification_level:v.qualification_level,p_active:v.active});}
  saveEquipment(v:MasterEquipment):Promise<unknown>{return this.call('mes_master_save_equipment',{p_id:v.id,p_code:v.code,p_name:v.name,p_work_center:v.work_center,p_capabilities:v.capabilities,p_active:v.active});}
  saveShift(v:MasterShift):Promise<unknown>{return this.call('mes_master_save_shift',{p_id:v.id,p_name:v.name,p_start_minute:v.start_minute,p_duration_minutes:v.duration_minutes,p_active:v.active});}
  saveProfession(v:MasterProfession):Promise<unknown>{return this.call('mes_master_save_profession',{p_id:v.id,p_external_id:v.external_id??null,p_code:v.code,p_name:v.name,p_description:v.description??null,p_active:v.active});}
  saveQualification(v:MasterQualification):Promise<unknown>{return this.call('mes_master_save_qualification',{p_id:v.id,p_external_id:v.external_id??null,p_code:v.code,p_name:v.name,p_level:v.level,p_description:v.description??null,p_active:v.active});}
  saveBrigade(v:MasterBrigade):Promise<unknown>{return this.call('mes_master_save_brigade',{p_id:v.id,p_external_id:v.external_id??null,p_code:v.code,p_name:v.name,p_description:v.description??null,p_active:v.active});}
  saveWorkCenter(v:MasterWorkCenter):Promise<unknown>{return this.call('mes_master_save_work_center',{p_id:v.id,p_external_id:v.external_id??null,p_code:v.code,p_name:v.name,p_site_code:v.site_code??null,p_description:v.description??null,p_active:v.active});}
  saveRoute(v:MasterRoute):Promise<unknown>{return this.call('mes_master_save_route',{p_id:v.id,p_external_id:v.external_id??null,p_product_id:v.product_id,p_code:v.code,p_name:v.name,p_version:v.version,p_active:v.active,p_valid_from:v.valid_from??null,p_valid_to:v.valid_to??null,p_description:v.description??null});}
  saveDowntimeReason(v:{code:string;name:string;category:string;is_planned:boolean;description?:string|null;active:boolean}):Promise<unknown>{return this.call('mes_master_save_downtime_reason',{p_code:v.code,p_name:v.name,p_category:v.category,p_is_planned:v.is_planned,p_description:v.description??null,p_active:v.active});}
  saveScrapReason(v:{code:string;name:string;category:string;description?:string|null;active:boolean}):Promise<unknown>{return this.call('mes_master_save_scrap_reason',{p_code:v.code,p_name:v.name,p_category:v.category,p_description:v.description??null,p_active:v.active});}
  async validateBootstrap(payload:BootstrapPayload):Promise<BootstrapValidation>{const data=await this.call('mes_validate_bootstrap',{p_payload:payload});if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES validation вернула некорректный результат');const x=data as Record<string,unknown>;return{valid:Boolean(x.valid),errors:Array.isArray(x.errors)?x.errors.map(String):[],warnings:Array.isArray(x.warnings)?x.warnings.map(String):[]};}
  async importBootstrap(sourceName:string,payload:BootstrapPayload):Promise<Record<string,unknown>>{const data=await this.call('mes_import_bootstrap',{p_source_name:sourceName,p_payload:payload});if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('MES импорт вернул некорректный результат');return data as Record<string,unknown>;}
}
