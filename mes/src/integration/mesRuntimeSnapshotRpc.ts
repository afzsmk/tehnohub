import type { SupabaseClient } from '@supabase/supabase-js';
import type { MesState } from '../types';

export type MesRuntimeSnapshot = Partial<MesState> & {
  plan: MesState['plan'] | null;
  calendarRevision?: number;
};

function requireSnapshot(data: unknown): MesRuntimeSnapshot {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('MES RPC mes_get_runtime_snapshot вернул некорректный снимок');
  }
  return data as MesRuntimeSnapshot;
}

export class SupabaseMesRuntimeSnapshotRpc {
  constructor(private readonly client: SupabaseClient) {}

  async load(planId?: string): Promise<MesRuntimeSnapshot> {
    const { data, error } = await this.client.rpc('mes_get_runtime_snapshot', {
      p_plan_id: planId ?? null
    });
    if (error) throw error;
    return requireSnapshot(data);
  }
}
