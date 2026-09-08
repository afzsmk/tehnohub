-- Enforce authenticated actor binding for operator execution data.
-- Elevated roles remain able to post events on behalf of the operational workflow.

alter table downtime_events
  add column if not exists actor_user_id uuid references auth.users(id);

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

drop policy if exists mes_write_downtime on downtime_events;
create policy mes_write_downtime on downtime_events
for insert to authenticated
with check (
  mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','MAINTENANCE'])
  or (
    mes_has_role(array['OPERATOR'])
    and actor_user_id = auth.uid()
    and mes_current_employee_id() is not null
  )
);

create index if not exists idx_downtime_actor_user on downtime_events(actor_user_id);
