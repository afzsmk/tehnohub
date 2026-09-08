-- Atomic server-side application of an approved operational replan.
-- The browser proposes time windows; PostgreSQL validates versions, horizon,
-- immutable tasks and resource collisions before committing the whole batch.

create or replace function mes_apply_replan(
  p_plan_id text,
  p_plan_version integer,
  p_changes jsonb
)
returns operational_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan operational_plans%rowtype;
  v_change record;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для перепланирования';
  end if;
  if coalesce(jsonb_typeof(p_changes), '') <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'p_changes не должен быть пустым';
  end if;

  select * into v_plan from operational_plans where id = p_plan_id for update;
  if not found then raise exception 'Операционный план не найден: %', p_plan_id; end if;
  if p_plan_version is null or v_plan.version <> p_plan_version then
    raise exception 'Версия плана устарела: ожидается %, фактически %', p_plan_version, v_plan.version;
  end if;

  create temporary table if not exists pg_temp.mes_replan_changes (
    task_id text primary key,
    expected_version integer not null,
    proposed_start timestamptz not null,
    proposed_end timestamptz not null
  ) on commit drop;
  truncate pg_temp.mes_replan_changes;

  insert into pg_temp.mes_replan_changes(task_id, expected_version, proposed_start, proposed_end)
  select
    item->>'taskId',
    (item->>'expectedVersion')::integer,
    (item->>'proposedStart')::timestamptz,
    (item->>'proposedEnd')::timestamptz
  from jsonb_array_elements(p_changes) as item;

  if exists (
    select 1 from pg_temp.mes_replan_changes c
    join production_tasks t on t.id = c.task_id
    join production_orders o on o.id = t.order_id
    where o.plan_id <> p_plan_id
  ) then raise exception 'Все задания перепланирования должны принадлежать указанному плану'; end if;

  if exists (
    select 1 from pg_temp.mes_replan_changes c
    left join production_tasks t on t.id = c.task_id
    where t.id is null
       or t.status in ('COMPLETED','CANCELLED')
       or t.version <> c.expected_version
  ) then raise exception 'Конфликт версий или попытка изменить завершённое задание'; end if;

  if exists (
    select 1 from pg_temp.mes_replan_changes
    where proposed_end <= proposed_start
       or proposed_start < v_plan.horizon_start
       or proposed_end > v_plan.horizon_end
  ) then raise exception 'Изменённый интервал выходит за горизонт плана'; end if;

  -- Changed tasks must not overlap each other when they share an employee/equipment.
  if exists (
    select 1
      from pg_temp.mes_replan_changes a
      join pg_temp.mes_replan_changes b on a.task_id < b.task_id
      join task_assignments aa on aa.task_id = a.task_id
      join task_assignments ab on ab.task_id = b.task_id
                                  and (aa.employee_id is not distinct from ab.employee_id
                                       or aa.equipment_id is not distinct from ab.equipment_id)
     where a.proposed_start < b.proposed_end and b.proposed_start < a.proposed_end
  ) then raise exception 'Перепланирование создаёт конфликт ресурсов между заданиями'; end if;

  -- Changed tasks must not overlap unchanged tasks sharing a resource.
  if exists (
    select 1
      from pg_temp.mes_replan_changes c
      join task_assignments ca on ca.task_id = c.task_id
      join production_tasks t on t.id <> c.task_id
      join task_assignments ta on ta.task_id = t.id
                                      and (ca.employee_id is not distinct from ta.employee_id
                                           or ca.equipment_id is not distinct from ta.equipment_id)
      join production_orders o on o.id = t.order_id and o.plan_id = p_plan_id
      where t.status not in ('COMPLETED','CANCELLED')
        and t.id not in (select task_id from pg_temp.mes_replan_changes)
        and c.proposed_start < t.planned_end
        and t.planned_start < c.proposed_end
  ) then raise exception 'Перепланирование создаёт конфликт с существующим заданием'; end if;

  for v_change in select c.*, t.planned_start, t.planned_end, t.version from pg_temp.mes_replan_changes c join production_tasks t on t.id = c.task_id loop
    v_before := jsonb_build_object('plannedStart', v_change.planned_start, 'plannedEnd', v_change.planned_end, 'version', v_change.version);
    update production_tasks
       set planned_start = v_change.proposed_start,
           planned_end = v_change.proposed_end,
           version = version + 1
     where id = v_change.task_id;
    v_after := jsonb_build_object('plannedStart', v_change.proposed_start, 'plannedEnd', v_change.proposed_end, 'version', v_change.version + 1);
    insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
    values (auth.uid()::text, 'PRODUCTION_TASK', v_change.task_id, 'REPLAN_APPLIED', v_before, v_after);
  end loop;

  update operational_plans
     set version = version + 1
   where id = p_plan_id
   returning * into v_plan;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'OPERATIONAL_PLAN',
    p_plan_id,
    'REPLAN_APPLIED',
    jsonb_build_object('version', p_plan_version),
    jsonb_build_object('version', v_plan.version)
  );

  return v_plan;
end;
$$;

grant execute on function mes_apply_replan(text,integer,jsonb) to authenticated;
