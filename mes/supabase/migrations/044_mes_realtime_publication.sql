-- Keep the MES operational dataset available to Supabase Realtime.
-- The application reacts to changes by reloading the authoritative runtime snapshot;
-- it never applies individual realtime payloads directly to local production state.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
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
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
