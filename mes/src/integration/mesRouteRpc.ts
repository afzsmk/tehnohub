import type { SupabaseClient } from '@supabase/supabase-js';
import type { RouteOperation } from '../types';

interface DbRouteOperation {
  id: string;
  product_id: string;
  sequence: number;
  code: string;
  name: string;
  work_center: string;
  required_qualification: number | null;
  required_equipment_ids: unknown;
  setup_minutes: number;
  run_minutes_per_unit: number;
  active: boolean;
}

function mapRow(row: DbRouteOperation): RouteOperation {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    code: row.code,
    name: row.name,
    workCenter: row.work_center,
    requiredQualification: row.required_qualification == null ? undefined : Number(row.required_qualification),
    requiredEquipmentIds: Array.isArray(row.required_equipment_ids)
      ? row.required_equipment_ids.filter((value): value is string => typeof value === 'string')
      : [],
    setupMinutes: Number(row.setup_minutes),
    runMinutesPerUnit: Number(row.run_minutes_per_unit)
  };
}

export class SupabaseMesRouteRpc {
  constructor(private readonly client: SupabaseClient) {}

  async save(operation: RouteOperation & { productId: string; active?: boolean }): Promise<RouteOperation> {
    const { data, error } = await this.client.rpc('mes_save_route_operation', {
      p_id: operation.id,
      p_product_id: operation.productId,
      p_sequence: operation.sequence,
      p_code: operation.code,
      p_name: operation.name,
      p_work_center: operation.workCenter,
      p_required_qualification: operation.requiredQualification ?? null,
      p_required_equipment_ids: operation.requiredEquipmentIds ?? [],
      p_setup_minutes: operation.setupMinutes,
      p_run_minutes_per_unit: operation.runMinutesPerUnit,
      p_active: operation.active ?? true
    });
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('MES RPC mes_save_route_operation вернул пустой результат');
    return mapRow(data as DbRouteOperation);
  }

  async remove(operationId: string): Promise<void> {
    const { error } = await this.client.rpc('mes_delete_route_operation', { p_id: operationId });
    if (error) throw error;
  }
}
