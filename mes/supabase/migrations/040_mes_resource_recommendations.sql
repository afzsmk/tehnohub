-- Server-side candidate recommendation for task assignment.
-- This is advisory only: mes_assign_task remains the authoritative validator.

create or replace function mes_recommend_task_resources(p_task_id text)
returns table(
  resource_type text,
  resource_id text,
  resource_name text,
  score numeric,
  reasons jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_product_id text;
  v_work_center text;
  v_operation_code text;
  v_required_qualification integer;
  v_required_equipment_ids jsonb;
  v_work_range tstzrange;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для подбора ресурсов';
  end if;

  select * into v_task from production_tasks where id = p_task_id;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Для завершённого или отменённого задания подбор ресурсов недоступен';
  end if;

  select o.product_id into v_product_id from production_orders o where o.id = v_task.order_id;
  select r.work_center, r.code, r.required_qualification, r.required_equipment_ids
    into v_work_center, v_operation_code, v_required_qualification, v_required_equipment_ids
    from route_operations r
   where r.id = v_task.operation_id and r.product_id = v_product_id and r.active;
  if not found then raise exception 'Активная операция маршрута не найдена'; end if;

  v_work_range := tstzrange(v_task.planned_start, v_task.planned_end, '[)');

  return query
  with employee_candidates as (
    select e.id, e.name,
      (greatest(0, e.qualification_level - coalesce(v_required_qualification,0)) * 10
       + (select count(*) from task_assignments a join production_tasks t on t.id=a.task_id
          where a.employee_id=e.id and t.id<>v_task.id
            and t.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')))::numeric as score,
      jsonb_build_array(format('Квалификация: %s',e.qualification_level),'Сотрудник активен','Нет пересечения по заданиям','Календарь/смена покрывают весь интервал') as reasons
    from employees e
    join lateral (
      select range_agg(tstzrange(
        ((cd.date::text || ' 00:00:00+00')::timestamptz) + (s.start_minute * interval '1 minute'),
        ((cd.date::text || ' 00:00:00+00')::timestamptz) + ((s.start_minute + s.duration_minutes) * interval '1 minute'),'[)')) as work_range
      from calendar_days cd
      join employee_schedules es on es.employee_id=e.id and es.date=cd.date and es.status='WORK'
      join shift_definitions s on s.active
       and s.id in (select jsonb_array_elements_text(coalesce(cd.shift_ids,'[]'::jsonb)))
       and s.id in (select jsonb_array_elements_text(coalesce(es.shift_ids,'[]'::jsonb)))
      where cd.is_working
        and cd.date between (v_task.planned_start at time zone 'UTC')::date
                        and ((v_task.planned_end - interval '1 microsecond') at time zone 'UTC')::date
    ) availability on availability.work_range @> v_work_range
    where e.active
      and (v_required_qualification is null or e.qualification_level >= v_required_qualification)
      and not exists (
        select 1 from task_assignments a join production_tasks t on t.id=a.task_id
        where a.employee_id=e.id and t.id<>v_task.id
          and t.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
          and tstzrange(t.planned_start,t.planned_end,'[)') && v_work_range
      )
  )
  select 'EMPLOYEE', id, name, score, reasons from employee_candidates order by score, name limit 20;

  return query
  with equipment_candidates as (
    select e.id, e.name,
      (select count(*) from task_assignments a join production_tasks t on t.id=a.task_id
       where a.equipment_id=e.id and t.id<>v_task.id
         and t.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
         and tstzrange(t.planned_start,t.planned_end,'[)') && v_work_range)::numeric as score,
      jsonb_build_array(format('Участок: %s',e.work_center),'Оборудование активно','Нет пересечения по заданиям','Нет блока или обслуживания на интервале') as reasons
    from equipment e
    where e.active and e.work_center=v_work_center
      and (jsonb_array_length(coalesce(v_required_equipment_ids,'[]'::jsonb))=0 or e.id in (select jsonb_array_elements_text(v_required_equipment_ids)))
      and (jsonb_array_length(coalesce(e.capabilities,'[]'::jsonb))=0 or e.capabilities ? v_operation_code or e.capabilities ? v_work_center)
      and not exists (
        select 1 from task_assignments a join production_tasks t on t.id=a.task_id
        where a.equipment_id=e.id and t.id<>v_task.id
          and t.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
          and tstzrange(t.planned_start,t.planned_end,'[)') && v_work_range
      )
      and not exists (select 1 from equipment_blocks b where b.equipment_id=e.id and tstzrange(b.start_at,b.end_at,'[)') && v_work_range)
      and not exists (select 1 from maintenance_orders m where m.equipment_id=e.id and m.status in ('PLANNED','IN_PROGRESS') and tstzrange(m.planned_start,m.planned_end,'[)') && v_work_range)
  )
  select 'EQUIPMENT', id, name, score, reasons from equipment_candidates order by score, name limit 20;
end;
$$;

grant execute on function mes_recommend_task_resources(text) to authenticated;
comment on function mes_recommend_task_resources(text) is
'Advisory server-side ranking of available employees and equipment for one MES task; final assignment is still validated by mes_assign_task.';
