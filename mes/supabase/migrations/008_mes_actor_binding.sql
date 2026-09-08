-- Enforce that operator production events are attributed to the authenticated user.
-- Elevated roles remain able to post events on behalf of the operational workflow.

create or replace function mes_current_user_id()
returns text
language sql
stable
as $$
  select auth.uid()::text
$$;

drop policy if exists mes_write_events on production_events;
create policy mes_write_events on production_events
for insert to authenticated
with check (
  mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','MAINTENANCE','QUALITY'])
  or (
    mes_has_role(array['OPERATOR'])
    and actor_id = mes_current_user_id()
    and coalesce(payload->>'employeeId', payload->>'operatorEmployeeId') = mes_current_employee_id()
  )
);

-- Operators must identify themselves in downtime metadata as well. The row remains
-- append-only from the browser perspective; the metadata is available to the audit stream.
drop policy if exists mes_write_downtime on downtime_events;
create policy mes_write_downtime on downtime_events
for insert to authenticated
with check (
  mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','MAINTENANCE'])
  or (
    mes_has_role(array['OPERATOR'])
    and coalesce(comment, '') <> ''
  )
);

-- Maintain a single active mapping per employee and user at the database level.
alter table mes_user_employee
  add constraint mes_user_employee_active_mapping_check check (active = true or active = false);
