-- Server-side employee availability validation for MES task readiness.
-- A task may become READY only when every assigned employee is covered by
-- working calendar days and scheduled shifts for the complete task interval.

create or replace function mes_assert_task_employee_calendar(p_task_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_employee_id text;
  v_employee_count integer;
  v_work_range tstzrange;
  v_employee_work_range tstzmultirange;
begin
  select * into v_task from production_tasks where id = p_task_id;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;

  select count(*) into v_employee_count
    from task_assignments
   where task_id = p_task_id and employee_id is not null;
  if v_employee_count = 0 then
    raise exception 'Для задания % не назначен сотрудник', p_task_id;
  end if;

  v_work_range := tstzrange(v_task.planned_start, v_task.planned_end, '[)');

  foreach v_employee_id in array (
    select coalesce(array_agg(distinct a.employee_id order by a.employee_id), '{}'::text[])
      from task_assignments a
     where a.task_id = p_task_id and a.employee_id is not null
  ) loop
    if not exists (
      select 1 from employees e where e.id = v_employee_id and e.active
    ) then
      raise exception 'Сотрудник % неактивен или не найден', v_employee_id;
    end if;

    select range_agg(
      tstzrange(
        ((cd.date::text || ' 00:00:00+00')::timestamptz) + (s.start_minute * interval '1 minute'),
        ((cd.date::text || ' 00:00:00+00')::timestamptz) + ((s.start_minute + s.duration_minutes) * interval '1 minute'),
        '[)'
      )
    )
      into v_employee_work_range
      from calendar_days cd
      join employee_schedules es
        on es.employee_id = v_employee_id
       and es.date = cd.date
       and es.status = 'WORK'
      join shift_definitions s
        on s.active
       and s.id in (select jsonb_array_elements_text(coalesce(cd.shift_ids, '[]'::jsonb)))
       and s.id in (select jsonb_array_elements_text(coalesce(es.shift_ids, '[]'::jsonb)))
     where cd.is_working
       and cd.date between
           ((v_task.planned_start at time zone 'UTC')::date)
           and ((v_task.planned_end - interval '1 microsecond') at time zone 'UTC')::date
       and tstzrange(
         ((cd.date::text || ' 00:00:00+00')::timestamptz),
         ((cd.date::text || ' 00:00:00+00')::timestamptz) + interval '1 day',
         '[)'
       ) && v_work_range;

    if v_employee_work_range is null or not (v_employee_work_range @> v_work_range) then
      raise exception 'Сотрудник % недоступен по календарю/сменам на интервал задания % — %',
        v_employee_id, v_task.planned_start, v_task.planned_end;
    end if;
  end loop;
end;
$$;

create or replace function mes_validate_ready_employee_calendar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'READY' and old.status is distinct from 'READY' then
    perform mes_assert_task_employee_calendar(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists production_tasks_ready_employee_calendar on production_tasks;
create trigger production_tasks_ready_employee_calendar
before update of status on production_tasks
for each row execute function mes_validate_ready_employee_calendar();

create index if not exists idx_employee_schedule_date_status
  on employee_schedules(employee_id, date, status);
