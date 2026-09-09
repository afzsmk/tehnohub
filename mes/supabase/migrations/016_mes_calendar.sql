-- Operational calendar and personnel schedule belong to MES and are editable only by planning roles.

create table if not exists shift_definitions (
  id text primary key,
  name text not null,
  start_minute integer not null check (start_minute between 0 and 1439),
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 1440),
  active boolean not null default true
);

create table if not exists calendar_days (
  date date primary key,
  is_working boolean not null,
  shift_ids jsonb not null default '[]'::jsonb
);

create table if not exists employee_schedules (
  employee_id text not null references employees(id) on delete cascade,
  date date not null,
  shift_ids jsonb not null default '[]'::jsonb,
  status text not null check (status in ('WORK','OFF','VACATION','SICK','ABSENCE')),
  primary key (employee_id, date)
);

alter table shift_definitions enable row level security;
alter table calendar_days enable row level security;
alter table employee_schedules enable row level security;

drop policy if exists mes_read_shifts on shift_definitions;
create policy mes_read_shifts on shift_definitions for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_manage_shifts on shift_definitions;
create policy mes_manage_shifts on shift_definitions for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']));

drop policy if exists mes_read_calendar on calendar_days;
create policy mes_read_calendar on calendar_days for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_manage_calendar on calendar_days;
create policy mes_manage_calendar on calendar_days for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']));

drop policy if exists mes_read_employee_schedules on employee_schedules;
create policy mes_read_employee_schedules on employee_schedules for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_manage_employee_schedules on employee_schedules;
create policy mes_manage_employee_schedules on employee_schedules for all to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'])) with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']));

create or replace function mes_save_calendar(
  p_calendar jsonb,
  p_employee_schedules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для изменения календаря';
  end if;
  if coalesce(jsonb_typeof(p_calendar), '') <> 'array' then raise exception 'p_calendar должен быть массивом'; end if;
  if coalesce(jsonb_typeof(p_employee_schedules), '') <> 'array' then raise exception 'p_employee_schedules должен быть массивом'; end if;

  insert into calendar_days(date, is_working, shift_ids)
  select (item->>'date')::date, coalesce((item->>'isWorking')::boolean, false), coalesce(item->'shiftIds','[]'::jsonb)
  from jsonb_array_elements(p_calendar) item
  on conflict(date) do update set is_working = excluded.is_working, shift_ids = excluded.shift_ids;

  insert into employee_schedules(employee_id, date, shift_ids, status)
  select item->>'employeeId', (item->>'date')::date, coalesce(item->'shiftIds','[]'::jsonb), item->>'status'
  from jsonb_array_elements(p_employee_schedules) item
  on conflict(employee_id,date) do update set shift_ids = excluded.shift_ids, status = excluded.status;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (auth.uid()::text, 'MES_CALENDAR', 'calendar', 'CALENDAR_SAVED', null,
    jsonb_build_object('calendarDays', jsonb_array_length(p_calendar), 'employeeSchedules', jsonb_array_length(p_employee_schedules)));

  return jsonb_build_object('accepted', true, 'calendarDays', jsonb_array_length(p_calendar), 'employeeSchedules', jsonb_array_length(p_employee_schedules));
end;
$$;

grant execute on function mes_save_calendar(jsonb,jsonb) to authenticated;
