import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type MesRealtimeTable = 'production_orders'|'production_tasks'|'task_assignments'|'production_results'|'quality_inspections'|'downtime_events'|'maintenance_orders'|'equipment_blocks'|'production_events';

export interface MesRealtimeOptions {
  tables: MesRealtimeTable[];
  onChange: () => void;
  debounceMs?: number;
}

export function subscribeMesRealtime(client: SupabaseClient, options: MesRealtimeOptions): () => void {
  const debounceMs = Math.max(100, Math.floor(options.debounceMs ?? 350));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel: RealtimeChannel = client.channel(`mes-live-${crypto.randomUUID()}`);
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; options.onChange(); }, debounceMs);
  };
  for (const table of [...new Set(options.tables)]) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule);
  }
  void channel.subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
