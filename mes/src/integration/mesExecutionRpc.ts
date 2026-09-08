import type { SupabaseClient } from '@supabase/supabase-js';
import type { DowntimeEvent, ProductionResult, ProductionTask } from '../types';

export type MesExecutionAction = 'START' | 'PAUSE' | 'RESUME' | 'BLOCK' | 'COMPLETE';

export interface MesExecutionRpc {
  executeTaskAction(taskId: string, action: MesExecutionAction, occurredAt?: string): Promise<ProductionTask>;
  recordProductionResult(
    taskId: string,
    goodQuantity: number,
    scrapQuantity: number,
    equipmentIds?: string[],
    comment?: string,
    recordedAt?: string
  ): Promise<ProductionResult>;
  startDowntime(equipmentId: string, reasonCode: string, comment?: string, startedAt?: string): Promise<DowntimeEvent>;
  endDowntime(downtimeId: string, endedAt?: string): Promise<DowntimeEvent>;
}

function assertRpcRow<T>(data: unknown, functionName: string): T {
  if (!data) throw new Error(`MES RPC ${functionName} вернул пустой результат`);
  return data as T;
}

export class SupabaseMesExecutionRpc implements MesExecutionRpc {
  constructor(private readonly client: SupabaseClient) {}

  async executeTaskAction(taskId: string, action: MesExecutionAction, occurredAt?: string): Promise<ProductionTask> {
    const { data, error } = await this.client.rpc('mes_execute_task_action', {
      p_task_id: taskId,
      p_action: action,
      p_occurred_at: occurredAt ?? new Date().toISOString()
    });
    if (error) throw error;
    return assertRpcRow<ProductionTask>(data, 'mes_execute_task_action');
  }

  async recordProductionResult(
    taskId: string,
    goodQuantity: number,
    scrapQuantity: number,
    equipmentIds: string[] = [],
    comment?: string,
    recordedAt?: string
  ): Promise<ProductionResult> {
    const { data, error } = await this.client.rpc('mes_record_production_result', {
      p_task_id: taskId,
      p_good_quantity: goodQuantity,
      p_scrap_quantity: scrapQuantity,
      p_equipment_ids: equipmentIds,
      p_comment: comment ?? null,
      p_recorded_at: recordedAt ?? new Date().toISOString()
    });
    if (error) throw error;
    return assertRpcRow<ProductionResult>(data, 'mes_record_production_result');
  }

  async startDowntime(equipmentId: string, reasonCode: string, comment?: string, startedAt?: string): Promise<DowntimeEvent> {
    const { data, error } = await this.client.rpc('mes_start_downtime', {
      p_equipment_id: equipmentId,
      p_reason_code: reasonCode,
      p_comment: comment ?? null,
      p_started_at: startedAt ?? new Date().toISOString()
    });
    if (error) throw error;
    return assertRpcRow<DowntimeEvent>(data, 'mes_start_downtime');
  }

  async endDowntime(downtimeId: string, endedAt?: string): Promise<DowntimeEvent> {
    const { data, error } = await this.client.rpc('mes_end_downtime', {
      p_downtime_id: downtimeId,
      p_ended_at: endedAt ?? new Date().toISOString()
    });
    if (error) throw error;
    return assertRpcRow<DowntimeEvent>(data, 'mes_end_downtime');
  }
}
