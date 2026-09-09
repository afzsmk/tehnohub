-- Defense in depth for MES browser sessions.
-- RLS policies remain authoritative for row visibility, while these grants
-- ensure authenticated clients cannot reach mutation statements directly.
-- SECURITY DEFINER MES RPCs execute with the function owner's privileges.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'operational_plans',
    'products',
    'employees',
    'equipment',
    'shift_definitions',
    'calendar_days',
    'employee_schedules',
    'route_operations',
    'production_orders',
    'production_tasks',
    'task_assignments',
    'equipment_blocks',
    'downtime_events',
    'maintenance_orders',
    'production_results',
    'quality_inspections',
    'production_events',
    'integration_messages',
    'integration_outbox',
    'audit_log'
  ] loop
    execute format(
      'revoke insert, update, delete on public.%I from authenticated',
      table_name
    );
  end loop;
end
$$;
