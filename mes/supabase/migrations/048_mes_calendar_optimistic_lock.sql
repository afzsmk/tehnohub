-- Prevent stale browser snapshots from overwriting newer calendar edits.
-- Calendar persistence is a bulk RPC, so a single transactional revision protects
-- the combined calendar_days + employee_schedules snapshot.

create table if not exists mes_calendar_revision (
  id boolean primary key default true check (id),
  revision bigint not null default 1 check (revision > 0)
);

insert into mes_calendar_revision(id, revision)
values (true, 1)
on conflict (id) do nothing;

alter table mes_calendar_revision enable row level security;
drop policy if exists mes_read_calendar_revision on mes_calendar_revision;
create policy mes_read_calendar_revision on mes_calendar_revision
  for select to authenticated using (mes_current_role() <> '');

-- Calendar data is persisted only through the controlled RPC. The SECURITY DEFINER
-- function remains able to write the tables while browser sessions cannot bypass it.
drop policy if exists mes_manage_calendar on calendar_days;
drop policy if exists mes_manage_employee_schedules on employee_schedules;

create or replace function mes_save_calendar(
  p_calendar jsonb,
  p_employee_schedules jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
  v_next_revision bigint;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для изменения календаря';
  end if;
  if coalesce(jsonb_typeof(p_calendar), '') <> 'array' then
    raise exception 'p_calendar должен быть массивом';
  end if;
  if coalesce(jsonb_typeof(p_employee_schedules), '') <> 'array' then
    raise exception 'p_employee_schedules должен быть массивом';
  end if;
  if p_expected_revision is null then
    raise exception 'Версия календаря обязательна для сохранения';
  end if;

  select revision into v_revision
  from mes_calendar_revision
  where id = true
  for update;

  if v_revision is null then
    raise exception 'Не инициализирована версия календаря';
  end if;
  if p_expected_revision <> v_revision then
    raise exception 'Календарь устарел: ожидалась версия %, актуальна версия %', p_expected_revision, v_revision;
  end if;

  insert into calendar_days(date, is_working, shift_ids)
  select (item->>'date')::date,
         coalesce((item->>'isWorking')::boolean, false),
         coalesce(item->'shiftIds','[]'::jsonb)
  from jsonb_array_elements(p_calendar) item
  on conflict(date) do update
    set is_working = excluded.is_working,
        shift_ids = excluded.shift_ids;

  insert into employee_schedules(employee_id, date, shift_ids, status)
  select item->>'employeeId',
         (item->>'date')::date,
         coalesce(item->'shiftIds','[]'::jsonb),
         item->>'status'
  from jsonb_array_elements(p_employee_schedules) item
  on conflict(employee_id,date) do update
    set shift_ids = excluded.shift_ids,
        status = excluded.status;

  v_next_revision := v_revision + 1;
  update mes_calendar_revision
  set revision = v_next_revision
  where id = true;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'MES_CALENDAR',
    'calendar',
    'CALENDAR_SAVED',
    jsonb_build_object('revision', v_revision),
    jsonb_build_object(
      'revision', v_next_revision,
      'calendarDays', jsonb_array_length(p_calendar),
      'employeeSchedules', jsonb_array_length(p_employee_schedules)
    )
  );

  return jsonb_build_object(
    'accepted', true,
    'calendarDays', jsonb_array_length(p_calendar),
    'employeeSchedules', jsonb_array_length(p_employee_schedules),
    'revision', v_next_revision
  );
end;
$$;

revoke all on function mes_save_calendar(jsonb,jsonb,bigint) from public;
grant execute on function mes_save_calendar(jsonb,jsonb,bigint) to authenticated;
