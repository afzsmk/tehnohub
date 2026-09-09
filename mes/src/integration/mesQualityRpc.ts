import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionTask, QualityInspection, QualityStatus } from '../types';

export interface MesQualityRpc {
  requestQualityCheck(taskId: string): Promise<ProductionTask>;
  setQualityRequired(taskId: string, required: boolean): Promise<ProductionTask>;
  submitQualityInspection(taskId: string, status: 'APPROVED'|'REJECTED', goodQuantity: number, scrapQuantity: number, defectCode?: string, comment?: string, inspectedAt?: string): Promise<QualityInspection>;
}

type DbTask = { id:string; order_id:string; operation_id:string; operation_sequence:number; status:ProductionTask['status']; planned_start:string; planned_end:string; actual_start:string|null; actual_end:string|null; planned_quantity:number; actual_quantity:number; quality_required:boolean|null; quality_status:QualityStatus|null; version:number; };
type DbInspection = { id:string; task_id:string; inspected_at:string; inspector_id:string; status:'PENDING'|'APPROVED'|'REJECTED'; good_quantity:number; scrap_quantity:number; defect_code:string|null; comment:string|null; };
function row<T>(data: unknown, name: string): T { if (!data) throw new Error(`MES RPC ${name} вернул пустой результат`); return data as T; }
function mapTask(r: DbTask): ProductionTask { return { id:r.id, orderId:r.order_id, operationId:r.operation_id, operationSequence:r.operation_sequence, status:r.status, plannedStart:r.planned_start, plannedEnd:r.planned_end, actualStart:r.actual_start ?? undefined, actualEnd:r.actual_end ?? undefined, plannedQuantity:Number(r.planned_quantity), actualQuantity:Number(r.actual_quantity), assignedEmployeeIds:[], assignedEquipmentIds:[], qualityRequired:Boolean(r.quality_required), qualityStatus:r.quality_status ?? 'NOT_REQUIRED', version:Number(r.version) }; }
function mapInspection(r: DbInspection): QualityInspection { return { id:r.id, taskId:r.task_id, inspectedAt:r.inspected_at, inspectorId:r.inspector_id, status:r.status, goodQuantity:Number(r.good_quantity), scrapQuantity:Number(r.scrap_quantity), defectCode:r.defect_code ?? undefined, comment:r.comment ?? undefined }; }
export class SupabaseMesQualityRpc implements MesQualityRpc {
  constructor(private readonly client: SupabaseClient) {}
  async requestQualityCheck(taskId: string): Promise<ProductionTask> { const { data,error }=await this.client.rpc('mes_request_quality_check',{p_task_id:taskId}); if(error) throw error; return mapTask(row<DbTask>(data,'mes_request_quality_check')); }
  async setQualityRequired(taskId: string, required: boolean): Promise<ProductionTask> { const { data,error }=await this.client.rpc('mes_set_task_quality_required',{p_task_id:taskId,p_required:required}); if(error) throw error; return mapTask(row<DbTask>(data,'mes_set_task_quality_required')); }
  async submitQualityInspection(taskId:string,status:'APPROVED'|'REJECTED',goodQuantity:number,scrapQuantity:number,defectCode?:string,comment?:string,inspectedAt?:string):Promise<QualityInspection>{ const normalizedDefectCode=defectCode?.trim() ? defectCode.trim() : null; const {data,error}=await this.client.rpc('mes_submit_quality_inspection',{p_task_id:taskId,p_status:status,p_good_quantity:goodQuantity,p_scrap_quantity:scrapQuantity,p_defect_code:normalizedDefectCode,p_comment:comment??null,p_inspected_at:inspectedAt??new Date().toISOString()}); if(error) throw error; return mapInspection(row<DbInspection>(data,'mes_submit_quality_inspection')); }
}
