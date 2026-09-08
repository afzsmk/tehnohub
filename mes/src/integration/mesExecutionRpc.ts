import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionResult, ProductionTask, DowntimeEvent } from '../types';

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
}

export class SupabaseMesExecutionRpc implements MesExecutionRpc {
  constructor(private readonly client: SupabaseClient) {}

  async executeTaskAction(taskId: string, action: MesExecutionAction, occurredAt?: string): Promise<ProductionTask> {
    const { data, error } = await this.client.rpc<ProductionTask>('mes_execute_task_action', {
      p_task_id: taskId,
      p_action: action,
      p_occurred_at: occurredAt ?? new Date().toISOString()
    });
    if (error) throw error;
    if (!data) throw new Error('MES RPC mes_execute_task_action вернул пустой результат');
    return data;
  }

  async recordProductionResult(
    taskId: string,
    goodQuantity: number,
    scrapQuantity: number,
    equipmentIds: string[] = [],
    comment?: string,
    recordedAt?: string
  ): Promise<ProductionResult> {
    const { data, error } = await this.client.rpc<ProductionResult>('mes_record_production_result', {
      p_task_id: taskId,
      p_good_quantity: goodQuantity,
      p_scrap_quantity: scrapQuantity,
      p_equipment_ids: equipmentIds,
      p_comment: comment ?? null,
      p_recorded_at: recordedAt ?? new Date().toISOString()
    });
    if (error) throw error;
    if (!data) throw new Error('MES RPC mes_record_production_result вернул пустой результат');
    return data;
  }

  async startDowntime(equipmentId: string, reasonCode: string, comment?: string, startedAt?: string): Promise<DowntimeEvent> {
    const { data, error } = await this.client.rpc<DowntimeEvent>('mes_start_downtime', {
      p_equipment_id: equipmentId,
      p_reason_code: reasonCode,
      p_comment: comment ?? null,
      p_started_at: startedAt ?? new Date().toISOString()
    });
    if (error) throw error;
    if (!data) throw new Error('MES RPC mes_start_downtime вернул пустой результат');
    return data;
  }
}
