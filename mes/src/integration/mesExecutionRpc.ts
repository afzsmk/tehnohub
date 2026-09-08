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

type DbTask = {
  id: string; order_id: string; operation_id: string; operation_sequence: number; status: ProductionTask['status'];
  planned_start: string; planned_end: string; actual_start: string | null; actual_end: string | null;
  planned_quantity: number; actual_quantity: number; version: number;
};

type DbResult = {
  id: string; task_id: string; recorded_at: string; good_quantity: number; scrap_quantity: number;
  employee_ids: unknown; equipment_ids: unknown; comment: string | null;
};

type DbDowntime = {
  id: string; equipment_id: string; reason_code: string; started_at: string; ended_at: string | null; comment: string | null;
};

type DbAssignment = { employee_id: string | null; equipment_id: string | null };

function assertRpcRow<T>(data: unknown, functionName: string): T {
  if (!data) throw new Error(`MES RPC ${functionName} вернул пустой результат`);
  return data as T;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

async function loadAssignments(client: SupabaseClient, taskId: string): Promise<{ employeeIds: string[]; equipmentIds: string[] }> {
  const { data, error } = await client
    .from('task_assignments')
    .select('employee_id,equipment_id')
    .eq('task_id', taskId);
  if (error) throw error;
  const rows = Array.isArray(data) ? data as DbAssignment[] : [];
  return {
    employeeIds: [...new Set(rows.map(row => row.employee_id).filter((id): id is string => Boolean(id)))].sort(),
    equipmentIds: [...new Set(rows.map(row => row.equipment_id).filter((id): id is string => Boolean(id)))].sort()
  };
}

function mapTask(row: DbTask, assignment: { employeeIds: string[]; equipmentIds: string[] } = { employeeIds: [], equipmentIds: [] }): ProductionTask {
  return {
    id: row.id,
    orderId: row.order_id,
    operationId: row.operation_id,
    operationSequence: row.operation_sequence,
    status: row.status,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    actualStart: row.actual_start ?? undefined,
    actualEnd: row.actual_end ?? undefined,
    plannedQuantity: Number(row.planned_quantity),
    actualQuantity: Number(row.actual_quantity),
    assignedEmployeeIds: [...assignment.employeeIds],
    assignedEquipmentIds: [...assignment.equipmentIds],
    version: Number(row.version)
  };
}

function mapResult(row: DbResult): ProductionResult {
  return {
    id: row.id,
    taskId: row.task_id,
    recordedAt: row.recorded_at,
    goodQuantity: Number(row.good_quantity),
    scrapQuantity: Number(row.scrap_quantity),
    employeeIds: asStringArray(row.employee_ids),
    equipmentIds: asStringArray(row.equipment_ids),
    comment: row.comment ?? undefined
  };
}

function mapDowntime(row: DbDowntime): DowntimeEvent {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    reasonCode: row.reason_code,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    comment: row.comment ?? undefined
  };
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
    const row = assertRpcRow<DbTask>(data, 'mes_execute_task_action');
    const assignment = await loadAssignments(this.client, taskId);
    return mapTask(row, assignment);
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
    return mapResult(assertRpcRow<DbResult>(data, 'mes_record_production_result'));
  }

  async startDowntime(equipmentId: string, reasonCode: string, comment?: string, startedAt?: string): Promise<DowntimeEvent> {
    const { data, error } = await this.client.rpc('mes_start_downtime', {
      p_equipment_id: equipmentId,
      p_reason_code: reasonCode,
      p_comment: comment ?? null,
      p_started_at: startedAt ?? new Date().toISOString()
    });
    if (error) throw error;
    return mapDowntime(assertRpcRow<DbDowntime>(data, 'mes_start_downtime'));
  }

  async endDowntime(downtimeId: string, endedAt?: string): Promise<DowntimeEvent> {
    const { data, error } = await this.client.rpc('mes_end_downtime', {
      p_downtime_id: downtimeId,
      p_ended_at: endedAt ?? new Date().toISOString()
    });
    if (error) throw error;
    return mapDowntime(assertRpcRow<DbDowntime>(data, 'mes_end_downtime'));
  }
}
