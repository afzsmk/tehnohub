select no_plan();

-- All critical MES tables must keep RLS enabled.
select ok((select relrowsecurity from pg_class where oid = 'public.operational_plans'::regclass), 'RLS enabled on operational_plans');
select ok((select relrowsecurity from pg_class where oid = 'public.production_orders'::regclass), 'RLS enabled on production_orders');
select ok((select relrowsecurity from pg_class where oid = 'public.production_tasks'::regclass), 'RLS enabled on production_tasks');
select ok((select relrowsecurity from pg_class where oid = 'public.task_assignments'::regclass), 'RLS enabled on task_assignments');
select ok((select relrowsecurity from pg_class where oid = 'public.production_results'::regclass), 'RLS enabled on production_results');
select ok((select relrowsecurity from pg_class where oid = 'public.quality_inspections'::regclass), 'RLS enabled on quality_inspections');
select ok((select relrowsecurity from pg_class where oid = 'public.production_events'::regclass), 'RLS enabled on production_events');
select ok((select relrowsecurity from pg_class where oid = 'public.downtime_events'::regclass), 'RLS enabled on downtime_events');
select ok((select relrowsecurity from pg_class where oid = 'public.route_operations'::regclass), 'RLS enabled on route_operations');
select ok((select relrowsecurity from pg_class where oid = 'public.calendar_days'::regclass), 'RLS enabled on calendar_days');
select ok((select relrowsecurity from pg_class where oid = 'public.employee_schedules'::regclass), 'RLS enabled on employee_schedules');
select ok((select relrowsecurity from pg_class where oid = 'public.equipment_blocks'::regclass), 'RLS enabled on equipment_blocks');
select ok((select relrowsecurity from pg_class where oid = 'public.maintenance_orders'::regclass), 'RLS enabled on maintenance_orders');

-- Browser sessions must not mutate MES state through the generic table API.
select ok(not has_table_privilege('authenticated', 'public.operational_plans', 'insert'), 'authenticated cannot insert operational_plans');
select ok(not has_table_privilege('authenticated', 'public.production_orders', 'insert'), 'authenticated cannot insert production_orders');
select ok(not has_table_privilege('authenticated', 'public.production_tasks', 'insert'), 'authenticated cannot insert production_tasks');
select ok(not has_table_privilege('authenticated', 'public.task_assignments', 'insert'), 'authenticated cannot insert task_assignments');
select ok(not has_table_privilege('authenticated', 'public.route_operations', 'insert'), 'authenticated cannot insert route_operations');
select ok(not has_table_privilege('authenticated', 'public.calendar_days', 'insert'), 'authenticated cannot insert calendar_days');
select ok(not has_table_privilege('authenticated', 'public.employee_schedules', 'insert'), 'authenticated cannot insert employee_schedules');
select ok(not has_table_privilege('authenticated', 'public.production_results', 'insert'), 'authenticated cannot insert production_results');
select ok(not has_table_privilege('authenticated', 'public.quality_inspections', 'insert'), 'authenticated cannot insert quality_inspections');
select ok(not has_table_privilege('authenticated', 'public.production_events', 'insert'), 'authenticated cannot insert production_events');
select ok(not has_table_privilege('authenticated', 'public.downtime_events', 'insert'), 'authenticated cannot insert downtime_events');
select ok(not has_table_privilege('authenticated', 'public.equipment_blocks', 'insert'), 'authenticated cannot insert equipment_blocks');
select ok(not has_table_privilege('authenticated', 'public.maintenance_orders', 'insert'), 'authenticated cannot insert maintenance_orders');

-- SECURITY DEFINER MES functions must never be callable anonymously.
select ok(not exists (
  select 1 from pg_proc p
  where p.prosecdef
    and p.proname like 'mes_%'
    and has_function_privilege('anon', p.oid, 'execute')
), 'no SECURITY DEFINER MES function is executable by anon');

-- Core browser-facing RPCs must remain callable by authenticated clients.
select ok(exists (
  select 1 from pg_proc p where p.proname = 'mes_change_order_status' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_change_order_status');
select ok(exists (
  select 1 from pg_proc p where p.proname = 'mes_save_calendar' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_save_calendar');
select ok(exists (
  select 1 from pg_proc p where p.proname = 'mes_submit_quality_inspection' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_submit_quality_inspection');
select ok(exists (
  select 1 from pg_proc p where p.proname = 'mes_execute_task_action' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'authenticated can execute mes_execute_task_action');

-- Explicit deny policies required by the privilege lockdown are present.
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='production_orders' and policyname='mes_no_direct_order_write'), 'production order deny policy exists');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='production_tasks' and policyname='mes_no_direct_task_write'), 'production task deny policy exists');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='task_assignments' and policyname='mes_no_direct_assignment_write'), 'task assignment deny policy exists');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='equipment_blocks' and policyname='mes_no_direct_block_write'), 'equipment block deny policy exists');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='maintenance_orders' and policyname='mes_no_direct_maintenance_write'), 'maintenance deny policy exists');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='mes_no_direct_product_write'), 'product deny policy exists');

select * from finish();
