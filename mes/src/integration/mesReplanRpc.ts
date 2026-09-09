import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperationalPlan } from '../types';

export interface MesReplanChange {
  taskId: string;
  proposedStart: string;
  proposedEnd: string;
  expectedVersion: number;
}

interface DbPlan {
  id: string;
  version: number;
  horizon_start: string;
  horizon_end: string;
  status: OperationalPlan['status'];
  source_plan_id: string | null;
  source_plan_version: number | null;
}

function requirePlan(data: unknown): DbPlan {
  if (!data || typeof data !== 'object') throw new Error('MES RPC mes_apply_replan вернул пустой результат');
  return data as DbPlan;
}

export class SupabaseMesReplanRpc {
  constructor(private readonly client: SupabaseClient) {}

  async apply(planId: string, planVersion: number, changes: MesReplanChange[]): Promise<OperationalPlan> {
    const { data, error } = await this.client.rpc('mes_apply_replan', {
      p_plan_id: planId,
      p_plan_version: planVersion,
      p_changes: changes
    });
    if (error) throw error;
    const row = requirePlan(data);
    return {
      id: row.id,
      version: Number(row.version),
      horizonStart: row.horizon_start,
      horizonEnd: row.horizon_end,
      status: row.status,
      sourcePlanId: row.source_plan_id ?? undefined,
      sourcePlanVersion: row.source_plan_version == null ? undefined : Number(row.source_plan_version)
    };
  }
}
