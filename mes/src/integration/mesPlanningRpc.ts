import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionTask } from '../types';

export interface MesTaskAssignment {
  employeeIds?: string[];
  equipmentIds?: string[];
}

interface DbTask {
  id: string;
  order_id: string;
  operation_id: string;
  operation_sequence: number;
  status: ProductionTask['status'];
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  planned_quantity: number;
  actual_quantity: number;
  version: number;
}

function requireRow(data: unknown): DbTask {
  if (!data || typeof data !== 'object') throw new Error('MES RPC вернул пустой результат');
  return data as DbTask;
}

function mapTask(row: DbTask, assignment: { employeeIds: string[]; equipmentIds: string[] }): ProductionTask {
  return {
    id: row.id,
    orderId: row.order_id,
    operationId: row.operation_id,
    operationSequence: Number(row.operation_sequence),
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

export class SupabaseMesPlanningRpc {
  constructor(private readonly client: SupabaseClient) {}

  async assignTask(taskId: string, assignment: MesTaskAssignment, expectedVersion?: number): Promise<ProductionTask> {
    const employeeIds = assignment.employeeIds === undefined ? null : [...new Set(assignment.employeeIds.filter(Boolean))];
    const equipmentIds = assignment.equipmentIds === undefined ? null : [...new Set(assignment.equipmentIds.filter(Boolean))];
    const { data, error } = await this.client.rpc('mes_assign_task', {
      p_task_id: taskId,
      p_employee_ids: employeeIds,
      p_equipment_ids: equipmentIds,
      p_expected_version: expectedVersion ?? null
    });
    if (error) throw error;
    return mapTask(requireRow(data), {
      employeeIds: employeeIds ?? [],
      equipmentIds: equipmentIds ?? []
    });
  }

  async prepareTask(taskId: string, expectedVersion?: number): Promise<ProductionTask> {
    const { data, error } = await this.client.rpc('mes_prepare_task', {
      p_task_id: taskId,
      p_expected_version: expectedVersion ?? null
    });
    if (error) throw error;
    return mapTask(requireRow(data), { employeeIds: [], equipmentIds: [] });
  }
}
