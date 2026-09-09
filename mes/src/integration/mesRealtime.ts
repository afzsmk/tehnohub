import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export const MES_REALTIME_TABLES = [
  'operational_plans',
  'production_orders',
  'production_tasks',
  'task_assignments',
  'calendar_days',
  'employee_schedules',
  'production_results',
  'quality_inspections',
  'downtime_events',
  'maintenance_orders',
  'equipment_blocks',
  'production_events'
] as const;

export type MesRealtimeTable = (typeof MES_REALTIME_TABLES)[number];

export interface MesRealtimeOptions {
  tables?: readonly MesRealtimeTable[];
  onChange: (table: MesRealtimeTable) => void;
  debounceMs?: number;
}

export function subscribeMesRealtime(client: SupabaseClient, options: MesRealtimeOptions): () => void {
  const debounceMs = Math.max(100, Math.floor(options.debounceMs ?? 350));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingTable: MesRealtimeTable | null = null;
  const channel: RealtimeChannel = client.channel(`mes-live-${crypto.randomUUID()}`);

  const schedule = (table: MesRealtimeTable) => {
    pendingTable = table;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const changedTable = pendingTable;
      pendingTable = null;
      timer = undefined;
      if (changedTable) options.onChange(changedTable);
    }, debounceMs);
  };

  for (const table of [...new Set(options.tables ?? MES_REALTIME_TABLES)]) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => schedule(table));
  }

  void channel.subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    pendingTable = null;
    void client.removeChannel(channel);
  };
}
