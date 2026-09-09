import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaintenanceOrder, DowntimeEvent } from '../types';

export type MaintenanceStatus = MaintenanceOrder['status'];
export type MaintenanceAction = 'START' | 'COMPLETE' | 'CANCEL';

interface DbMaintenance {
  id: string; equipment_id: string; type: MaintenanceOrder['type'];
  planned_start: string; planned_end: string; status: MaintenanceStatus; comment: string | null;
}
interface DbDowntime {
  id: string; equipment_id: string; reason_code: string; started_at: string; ended_at: string | null; comment: string | null;
}
function row<T>(data: unknown, name: string): T {
  if (!data) throw new Error(`MES RPC ${name} вернул пустой результат`);
  return data as T;
}
function mapMaintenance(r: DbMaintenance): MaintenanceOrder {
  return { id:r.id, equipmentId:r.equipment_id, type:r.type, plannedStart:r.planned_start, plannedEnd:r.planned_end, status:r.status, comment:r.comment ?? undefined };
}
function mapDowntime(r: DbDowntime): DowntimeEvent {
  return { id:r.id, equipmentId:r.equipment_id, reasonCode:r.reason_code, startedAt:r.started_at, endedAt:r.ended_at ?? undefined, comment:r.comment ?? undefined };
}

export class SupabaseMesMaintenanceRpc {
  constructor(private readonly client: SupabaseClient) {}

  async createOrder(equipmentId:string,type:MaintenanceOrder['type'],plannedStart:string,plannedEnd:string,comment?:string):Promise<MaintenanceOrder> {
    const {data,error}=await this.client.rpc('mes_create_maintenance_order',{p_equipment_id:equipmentId,p_type:type,p_planned_start:plannedStart,p_planned_end:plannedEnd,p_comment:comment??null});
    if(error) throw error;
    return mapMaintenance(row<DbMaintenance>(data,'mes_create_maintenance_order'));
  }

  async changeStatus(orderId:string,action:MaintenanceAction):Promise<MaintenanceOrder> {
    const next:MaintenanceStatus = action==='START'?'IN_PROGRESS':action==='COMPLETE'?'DONE':'CANCELLED';
    const {data,error}=await this.client.rpc('mes_change_maintenance_status',{p_order_id:orderId,p_next_status:next});
    if(error) throw error;
    return mapMaintenance(row<DbMaintenance>(data,'mes_change_maintenance_status'));
  }

  async startDowntime(equipmentId:string,reasonCode:string,comment?:string,startedAt?:string):Promise<DowntimeEvent> {
    const {data,error}=await this.client.rpc('mes_start_downtime',{p_equipment_id:equipmentId,p_reason_code:reasonCode,p_comment:comment??null,p_started_at:startedAt??new Date().toISOString()});
    if(error) throw error;
    return mapDowntime(row<DbDowntime>(data,'mes_start_downtime'));
  }

  async endDowntime(downtimeId:string,endedAt?:string):Promise<DowntimeEvent> {
    const {data,error}=await this.client.rpc('mes_end_downtime',{p_downtime_id:downtimeId,p_ended_at:endedAt??new Date().toISOString()});
    if(error) throw error;
    return mapDowntime(row<DbDowntime>(data,'mes_end_downtime'));
  }
}
