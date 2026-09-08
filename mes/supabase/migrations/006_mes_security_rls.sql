-- MES security baseline: authenticated users receive access according to
-- auth.jwt()->'app_metadata'->>'mes_role'. service_role continues to bypass RLS.

create or replace function mes_current_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'mes_role', '')
$$;

create or replace function mes_has_role(roles text[])
returns boolean
language sql
stable
as $$
  select mes_current_role() = any(roles)
$$;

alter table operational_plans enable row level security;
alter table products enable row level security;
alter table employees enable row level security;
alter table equipment enable row level security;
alter table production_orders enable row level security;
alter table production_tasks enable row level security;
alter table task_assignments enable row level security;
alter table equipment_blocks enable row level security;
alter table downtime_events enable row level security;
alter table maintenance_orders enable row level security;
alter table production_results enable row level security;
alter table production_events enable row level security;
alter table integration_messages enable row level security;
alter table audit_log enable row level security;
alter table integration_outbox enable row level security;

-- Read access is intentionally broad for authenticated MES users; write access
-- remains role-specific below. This keeps dashboards usable without granting
-- execution or master-data mutation rights to every operator.

drop policy if exists mes_read_operational_plans on operational_plans;
create policy mes_read_operational_plans on operational_plans for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_products on products;
create policy mes_read_products on products for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_employees on employees;
create policy mes_read_employees on employees for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_equipment on equipment;
create policy mes_read_equipment on equipment for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_orders on production_orders;
create policy mes_read_orders on production_orders for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_tasks on production_tasks;
create policy mes_read_tasks on production_tasks for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_assignments on task_assignments;
create policy mes_read_assignments on task_assignments for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_blocks on equipment_blocks;
create policy mes_read_blocks on equipment_blocks for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_downtime on downtime_events;
create policy mes_read_downtime on downtime_events for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_maintenance on maintenance_orders;
create policy mes_read_maintenance on maintenance_orders for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_results on production_results;
create policy mes_read_results on production_results for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_events on production_events;
create policy mes_read_events on production_events for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_messages on integration_messages;
create policy mes_read_messages on integration_messages for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_read_audit on audit_log;
create policy mes_read_audit on audit_log for select to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','ANALYST']));

drop policy if exists mes_read_outbox on integration_outbox;
create policy mes_read_outbox on integration_outbox for select to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','ANALYST']));

-- Planning/master-data mutations.
drop policy if exists mes_manage_plans on operational_plans;
create policy mes_manage_plans on operational_plans for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']));

drop policy if exists mes_manage_products on products;
create policy mes_manage_products on products for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']));

drop policy if exists mes_manage_employees on employees;
create policy mes_manage_employees on employees for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER']));

drop policy if exists mes_manage_equipment on equipment;
create policy mes_manage_equipment on equipment for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE']));

drop policy if exists mes_manage_orders on production_orders;
create policy mes_manage_orders on production_orders for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER']));

drop policy if exists mes_manage_tasks on production_tasks;
create policy mes_manage_tasks on production_tasks for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']));

drop policy if exists mes_manage_assignments on task_assignments;
create policy mes_manage_assignments on task_assignments for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']));

drop policy if exists mes_manage_blocks on equipment_blocks;
create policy mes_manage_blocks on equipment_blocks for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE']));

drop policy if exists mes_manage_maintenance on maintenance_orders;
create policy mes_manage_maintenance on maintenance_orders for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE']));

-- Execution writes. Operators can record their own execution data through the
-- application. Database-level actor matching is intentionally added in a later
-- hardening step once auth user <-> personnel mapping exists.
drop policy if exists mes_write_downtime on downtime_events;
create policy mes_write_downtime on downtime_events for insert to authenticated with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR','MAINTENANCE']));

-- Results/events are append-only by trigger; only INSERT is exposed.
drop policy if exists mes_write_results on production_results;
create policy mes_write_results on production_results for insert to authenticated with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR','QUALITY']));

drop policy if exists mes_write_events on production_events;
create policy mes_write_events on production_events for insert to authenticated with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR','MAINTENANCE','QUALITY']));

-- Outbox is written by SECURITY DEFINER trigger/RPCs, not directly by browser users.
drop policy if exists mes_no_direct_outbox_insert on integration_outbox;
create policy mes_no_direct_outbox_insert on integration_outbox for insert to authenticated with check (false);

drop policy if exists mes_no_direct_outbox_update on integration_outbox;
create policy mes_no_direct_outbox_update on integration_outbox for update to authenticated using (false) with check (false);

drop policy if exists mes_no_direct_outbox_delete on integration_outbox;
create policy mes_no_direct_outbox_delete on integration_outbox for delete to authenticated using (false);

-- integration_messages are owned by integration RPCs/triggers.
drop policy if exists mes_no_direct_messages_write on integration_messages;
create policy mes_no_direct_messages_write on integration_messages for all to authenticated using (false) with check (false);

-- audit_log must never be modified directly by browser sessions.
drop policy if exists mes_no_direct_audit_write on audit_log;
create policy mes_no_direct_audit_write on audit_log for all to authenticated using (false) with check (false);
