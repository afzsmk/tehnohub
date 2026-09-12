select no_plan();

-- Every table behind the MES controlled-write boundary must keep RLS enabled.
select ok(
  bool_and(c.relrowsecurity),
  'RLS enabled on all MES controlled-write tables'
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any (array[
    'operational_plans', 'products', 'employees', 'professions', 'qualification_levels', 'employee_qualifications', 'brigades',
    'equipment', 'shift_definitions', 'calendar_days', 'employee_schedules', 'route_operations',
    'production_orders', 'production_tasks', 'task_assignments', 'equipment_blocks', 'downtime_events',
    'maintenance_orders', 'production_results', 'quality_inspections', 'downtime_reasons', 'scrap_reasons',
    'production_events', 'integration_messages', 'integration_outbox', 'audit_log'
  ]);

-- Browser sessions must not mutate MES state through the generic table API.
select ok(
  not exists (
    select 1
    from unnest(array[
      'operational_plans', 'products', 'employees', 'professions', 'qualification_levels', 'employee_qualifications', 'brigades',
      'equipment', 'shift_definitions', 'calendar_days', 'employee_schedules', 'route_operations',
      'production_orders', 'production_tasks', 'task_assignments', 'equipment_blocks', 'downtime_events',
      'maintenance_orders', 'production_results', 'quality_inspections', 'downtime_reasons', 'scrap_reasons',
      'production_events', 'integration_messages', 'integration_outbox', 'audit_log'
    ]) as t(table_name)
    where has_table_privilege('authenticated', 'public.' || table_name, 'insert')
       or has_table_privilege('authenticated', 'public.' || table_name, 'update')
       or has_table_privilege('authenticated', 'public.' || table_name, 'delete')
  ),
  'authenticated has no INSERT/UPDATE/DELETE privilege on controlled MES tables'
);

-- SECURITY DEFINER MES functions must never be callable anonymously.
select ok(not exists (
  select 1
  from pg_proc p
  where p.prosecdef
    and p.proname like 'mes_%'
    and has_function_privilege('anon', p.oid, 'execute')
), 'no SECURITY DEFINER MES function is executable by anon');

-- SECURITY DEFINER MES functions must pin the search_path so callers cannot
-- influence name resolution through a hostile session search_path.
select ok(not exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.proname like 'mes_%'
    and not ('search_path=public' = any(coalesce(p.proconfig, array[]::text[])))
), 'all SECURITY DEFINER MES functions pin search_path to public');

-- Internal consistency helpers are trigger implementation details, not browser APIs.
select ok(
  not has_function_privilege('authenticated', 'public.mes_sync_order_from_task(text)', 'execute'),
  'authenticated cannot execute internal order consistency helper'
);
select ok(
  not has_function_privilege('authenticated', 'public.mes_sync_order_after_task_change()', 'execute'),
  'authenticated cannot execute internal task trigger helper'
);

-- Workforce -> MES plan ingestion is server-to-server only. The browser must
-- reach the Workforce publisher Edge Function instead of calling this RPC.
select ok(
  not has_function_privilege('public', 'public.mes_import_workforce_plan(jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'public.mes_import_workforce_plan(jsonb,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.mes_import_workforce_plan(jsonb,text)', 'execute')
  and has_function_privilege('service_role', 'public.mes_import_workforce_plan(jsonb,text)', 'execute'),
  'Workforce plan import RPC is executable only by service_role'
);

-- Core browser-facing RPCs must remain callable by authenticated clients.
select ok(exists (
  select 1 from pg_proc p
  where p.proname = 'mes_change_order_status' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_change_order_status');
select ok(exists (
  select 1 from pg_proc p
  where p.proname = 'mes_save_calendar' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_save_calendar');
select ok(exists (
  select 1 from pg_proc p
  where p.proname = 'mes_submit_quality_inspection' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_submit_quality_inspection');
select ok(exists (
  select 1 from pg_proc p
  where p.proname = 'mes_execute_task_action' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_execute_task_action');

-- Explicit deny policies required by the privilege lockdown are present.
select ok(
  (select count(*) from pg_policies where schemaname = 'public' and (
    (tablename = 'products' and policyname = 'mes_no_direct_product_write') or
    (tablename = 'employees' and policyname = 'mes_no_direct_employee_write') or
    (tablename = 'equipment' and policyname = 'mes_no_direct_equipment_write') or
    (tablename = 'shift_definitions' and policyname = 'mes_no_direct_shift_write') or
    (tablename = 'production_orders' and policyname = 'mes_no_direct_order_write') or
    (tablename = 'production_tasks' and policyname = 'mes_no_direct_task_write') or
    (tablename = 'task_assignments' and policyname = 'mes_no_direct_assignment_write') or
    (tablename = 'equipment_blocks' and policyname = 'mes_no_direct_block_write') or
    (tablename = 'maintenance_orders' and policyname = 'mes_no_direct_maintenance_write')
  )) = 9,
  'all required MES direct-write deny policies exist'
);

select * from finish();
