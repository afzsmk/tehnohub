-- Bind authenticated MES users to exactly one employee record.
-- Mapping is separate from employee master data and can be disabled without deleting history.

create table if not exists mes_user_employee (
  user_id uuid primary key references auth.users(id) on delete cascade,
  employee_id text not null unique references employees(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function mes_current_employee_id()
returns text
language sql
stable
as $$
  select m.employee_id::text
    from mes_user_employee m
   where m.user_id = auth.uid()
     and m.active = true
   limit 1
$$;

create or replace function mes_actor_matches_employee(p_employee_id text)
returns boolean
language sql
stable
as $$
  select mes_current_employee_id() = p_employee_id
$$;

alter table mes_user_employee enable row level security;

drop policy if exists mes_read_own_user_employee on mes_user_employee;
create policy mes_read_own_user_employee on mes_user_employee
for select to authenticated
using (user_id = auth.uid() or mes_has_role(array['ADMIN','PRODUCTION_MANAGER']));

drop policy if exists mes_manage_user_employee on mes_user_employee;
create policy mes_manage_user_employee on mes_user_employee
for all to authenticated
using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER']))
with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER']));

-- Require authenticated execution writes to reference the caller's employee mapping.
drop policy if exists mes_write_results on production_results;
create policy mes_write_results on production_results
for insert to authenticated
with check (
  mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','QUALITY'])
  or (
    mes_has_role(array['OPERATOR'])
    and exists (
      select 1
        from jsonb_array_elements_text(employee_ids) as ids(employee_id)
       where ids.employee_id = mes_current_employee_id()
    )
  )
);

drop policy if exists mes_write_events on production_events;
create policy mes_write_events on production_events
for insert to authenticated
with check (
  mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','MAINTENANCE','QUALITY'])
  or (
    mes_has_role(array['OPERATOR'])
    and coalesce(payload->>'employeeId', payload->>'operatorEmployeeId') = mes_current_employee_id()
  )
);

-- Operators may create downtime only for equipment assigned by application flow;
-- actor binding is carried in the event stream rather than mutating downtime history.

drop policy if exists mes_write_downtime on downtime_events;
create policy mes_write_downtime on downtime_events
for insert to authenticated
with check (
  mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','MAINTENANCE'])
  or mes_has_role(array['OPERATOR'])
);

-- Keep auth mapping private from ordinary authenticated users.
drop policy if exists mes_no_delete_user_employee on mes_user_employee;
create policy mes_no_delete_user_employee on mes_user_employee
for delete to authenticated
using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER']));
