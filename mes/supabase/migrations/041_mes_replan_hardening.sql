-- Harden operational replanning so PostgreSQL validates the same hard constraints
-- that govern scheduling/assignment before any proposed interval is persisted.
-- The migration supersedes mes_apply_replan without editing already-applied files.

create or replace function mes_assert_replan_employee_calendar(
  p_employee_id text,
  p_planned_start timestamptz,
  p_planned_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_range tstzrange;
  v_employee_work_range tstzmultirange;
begin
  if p_employee_id is null or p_planned_end <= p_planned_start then
    raise exception 'Некорректный интервал задания для проверки календаря';
  end if;

  if not exists (select 1 from employees e where e.id = p_employee_id and e.active) then
    raise exception 'Сотрудник % неактивен или не найден', p_employee_id;
  end if;

  v_work_range := tstzrange(p_planned_start, p_planned_end, '[)');

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
      on es.employee_id = p_employee_id
     and es.date = cd.date
     and es.status = 'WORK'
    join shift_definitions s
      on s.active
     and s.id in (select jsonb_array_elements_text(coalesce(cd.shift_ids, '[]'::jsonb)))
     and s.id in (select jsonb_array_elements_text(coalesce(es.shift_ids, '[]'::jsonb)))
   where cd.is_working
     and cd.date between
         ((p_planned_start at time zone 'UTC')::date)
         and ((p_planned_end - interval '1 microsecond') at time zone 'UTC')::date
     and tstzrange(
       ((cd.date::text || ' 00:00:00+00')::timestamptz),
       ((cd.date::text || ' 00:00:00+00')::timestamptz) + interval '1 day',
       '[)'
     ) && v_work_range;

  if v_employee_work_range is null or not (v_employee_work_range @> v_work_range) then
    raise exception 'Сотрудник % недоступен по календарю/сменам на интервал задания % — %',
      p_employee_id, p_planned_start, p_planned_end;
  end if;
end;
$$;

grant execute on function mes_assert_replan_employee_calendar(text,timestamptz,timestamptz) to authenticated;

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
  v_employee_id text;
  v_equipment_id text;
  v_product_id text;
  v_operation_work_center text;
  v_operation_code text;
  v_required_qualification integer;
  v_required_equipment_ids jsonb;
  v_capabilities jsonb;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для перепланирования';
  end if;
  if coalesce(jsonb_typeof(p_changes), '') <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'p_changes не должен быть пустым';
  end if;

  -- Plan lock is the primary serialization point and matches assignment RPC lock order.
  select * into v_plan
    from operational_plans
   where id = p_plan_id
   for update;
  if not found then
    raise exception 'Операционный план не найден: %', p_plan_id;
  end if;
  if p_plan_version is null or v_plan.version <> p_plan_version then
    raise exception 'Версия плана устарела: ожидается %, фактически %', p_plan_version, v_plan.version;
  end if;

  create temporary table if not exists mes_replan_changes (
    task_id text primary key,
    expected_version integer not null,
    proposed_start timestamptz not null,
    proposed_end timestamptz not null
  ) on commit drop;
  truncate mes_replan_changes;

  insert into mes_replan_changes(task_id, expected_version, proposed_start, proposed_end)
  select
    item->>'taskId',
    (item->>'expectedVersion')::integer,
    (item->>'proposedStart')::timestamptz,
    (item->>'proposedEnd')::timestamptz
  from jsonb_array_elements(p_changes) as item;

  if exists (
    select 1
      from mes_replan_changes c
      left join production_tasks t on t.id = c.task_id
     where t.id is null
        or t.status in ('COMPLETED','CANCELLED')
        or t.version <> c.expected_version
  ) then
    raise exception 'Конфликт версий или попытка изменить завершённое/отменённое задание';
  end if;

  if exists (
    select 1
      from mes_replan_changes c
      join production_tasks t on t.id = c.task_id
      join production_orders o on o.id = t.order_id
     where o.plan_id <> p_plan_id
  ) then
    raise exception 'Все задания перепланирования должны принадлежать указанному плану';
  end if;

  if exists (
    select 1
      from mes_replan_changes
     where proposed_end <= proposed_start
        or proposed_start < v_plan.horizon_start
        or proposed_end > v_plan.horizon_end
  ) then
    raise exception 'Изменённый интервал выходит за горизонт плана';
  end if;

  -- Acquire deterministic resource locks before availability checks. This serializes
  -- replan against concurrent assignment/replan transactions for the same resources.
  for v_employee_id in
    select distinct a.employee_id
      from mes_replan_changes c
      join task_assignments a on a.task_id = c.task_id
     where a.employee_id is not null
     order by a.employee_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('mes:employee:' || v_employee_id, 0));
  end loop;

  for v_equipment_id in
    select distinct a.equipment_id
      from mes_replan_changes c
      join task_assignments a on a.task_id = c.task_id
     where a.equipment_id is not null
     order by a.equipment_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('mes:equipment:' || v_equipment_id, 0));
  end loop;

  -- Validate every changed task against route/resource master data and the proposed interval.
  for v_change in
    select c.*, t.order_id, t.operation_id, t.operation_sequence
      from mes_replan_changes c
      join production_tasks t on t.id = c.task_id
  loop
    select o.product_id
      into v_product_id
      from production_orders o
     where o.id = v_change.order_id;
    if v_product_id is null then
      raise exception 'Продукт заказа задания не найден: %', v_change.task_id;
    end if;

    select r.work_center, r.code, r.required_qualification, r.required_equipment_ids
      into v_operation_work_center, v_operation_code, v_required_qualification, v_required_equipment_ids
      from route_operations r
     where r.id = v_change.operation_id
       and r.product_id = v_product_id
       and r.active;
    if not found then
      raise exception 'Активная операция маршрута не найдена или не соответствует продукту заказа: %', v_change.operation_id;
    end if;

    if v_required_qualification is not null and not exists (
      select 1
        from task_assignments a
        join employees e on e.id = a.employee_id
       where a.task_id = v_change.task_id
         and a.employee_id is not null
         and e.active
         and e.qualification_level >= v_required_qualification
    ) then
      raise exception 'Для операции % не назначен сотрудник с требуемой квалификацией %', v_operation_code, v_required_qualification;
    end if;

    if exists (
      select 1
        from jsonb_array_elements_text(coalesce(v_required_equipment_ids, '[]'::jsonb)) as required_id
       where not exists (
         select 1
           from task_assignments a
          where a.task_id = v_change.task_id
            and a.equipment_id = required_id
       )
    ) then
      raise exception 'Не все обязательные единицы оборудования назначены для операции %', v_operation_code;
    end if;

    for v_employee_id in
      select distinct a.employee_id
        from task_assignments a
       where a.task_id = v_change.task_id
         and a.employee_id is not null
       order by a.employee_id
    loop
      if v_required_qualification is not null and not exists (
        select 1 from employees e
         where e.id = v_employee_id
           and e.active
           and e.qualification_level >= v_required_qualification
      ) then
        raise exception 'Сотрудник % не соответствует квалификации для операции %', v_employee_id, v_operation_code;
      end if;

      perform mes_assert_replan_employee_calendar(
        v_employee_id,
        v_change.proposed_start,
        v_change.proposed_end
      );

      if exists (
        select 1
          from task_assignments a
          join production_tasks other_task on other_task.id = a.task_id
          left join mes_replan_changes other_change on other_change.task_id = other_task.id
         where a.employee_id = v_employee_id
           and other_task.id <> v_change.task_id
           and other_task.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
           and tstzrange(
                 coalesce(other_change.proposed_start, other_task.planned_start),
                 coalesce(other_change.proposed_end, other_task.planned_end),
                 '[)'
               )
               && tstzrange(v_change.proposed_start, v_change.proposed_end, '[)')
      ) then
        raise exception 'Сотрудник % уже занят пересекающимся заданием при предложенном перепланировании', v_employee_id;
      end if;
    end loop;

    for v_equipment_id in
      select distinct a.equipment_id
        from task_assignments a
       where a.task_id = v_change.task_id
         and a.equipment_id is not null
       order by a.equipment_id
    loop
      if not exists (select 1 from equipment e where e.id = v_equipment_id and e.active) then
        raise exception 'Активное оборудование не найдено: %', v_equipment_id;
      end if;

      select e.capabilities
        into v_capabilities
        from equipment e
       where e.id = v_equipment_id;

      if exists (
        select 1
          from equipment e
         where e.id = v_equipment_id
           and e.work_center <> v_operation_work_center
      ) then
        raise exception 'Оборудование % относится к другому производственному участку', v_equipment_id;
      end if;

      if jsonb_array_length(coalesce(v_capabilities, '[]'::jsonb)) > 0
         and not (coalesce(v_capabilities, '[]'::jsonb) ? v_operation_code)
         and not (coalesce(v_capabilities, '[]'::jsonb) ? v_operation_work_center) then
        raise exception 'Оборудование % не имеет совместимой capability для операции %', v_equipment_id, v_operation_code;
      end if;

      if exists (
        select 1
          from task_assignments a
          join production_tasks other_task on other_task.id = a.task_id
          left join mes_replan_changes other_change on other_change.task_id = other_task.id
         where a.equipment_id = v_equipment_id
           and other_task.id <> v_change.task_id
           and other_task.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
           and tstzrange(
                 coalesce(other_change.proposed_start, other_task.planned_start),
                 coalesce(other_change.proposed_end, other_task.planned_end),
                 '[)'
               )
               && tstzrange(v_change.proposed_start, v_change.proposed_end, '[)')
      ) then
        raise exception 'Оборудование % занято пересекающимся заданием при предложенном перепланировании', v_equipment_id;
      end if;

      if exists (
        select 1
          from equipment_blocks b
         where b.equipment_id = v_equipment_id
           and tstzrange(b.start_at, b.end_at, '[)')
               && tstzrange(v_change.proposed_start, v_change.proposed_end, '[)')
      ) then
        raise exception 'Оборудование % заблокировано на предложенном интервале', v_equipment_id;
      end if;

      if exists (
        select 1
          from maintenance_orders m
         where m.equipment_id = v_equipment_id
           and m.status in ('PLANNED','IN_PROGRESS')
           and tstzrange(m.planned_start, m.planned_end, '[)')
               && tstzrange(v_change.proposed_start, v_change.proposed_end, '[)')
      ) then
        raise exception 'На оборудовании % запланировано обслуживание, пересекающееся с предложенным интервалом', v_equipment_id;
      end if;
    end loop;

    -- Preserve technological sequence for the order. For changed peers use their
    -- proposed interval; otherwise use the persisted schedule.
    if exists (
      select 1
        from production_tasks other_task
        join production_orders other_order on other_order.id = other_task.order_id
        left join mes_replan_changes other_change on other_change.task_id = other_task.id
       where other_task.order_id = v_change.order_id
         and other_task.id <> v_change.task_id
         and other_task.operation_sequence < v_change.operation_sequence
         and other_task.status <> 'CANCELLED'
         and coalesce(
               other_task.actual_end,
               coalesce(other_change.proposed_end, other_task.planned_end)
             ) > v_change.proposed_start
    ) then
      raise exception 'Предложенный старт задания % нарушает последовательность технологического маршрута', v_change.task_id;
    end if;

    if exists (
      select 1
        from production_tasks other_task
        join production_orders other_order on other_order.id = other_task.order_id
        left join mes_replan_changes other_change on other_change.task_id = other_task.id
       where other_task.order_id = v_change.order_id
         and other_task.id <> v_change.task_id
         and other_task.operation_sequence > v_change.operation_sequence
         and other_task.status <> 'CANCELLED'
         and v_change.proposed_end > coalesce(other_change.proposed_start, other_task.planned_start)
    ) then
      raise exception 'Предложенный конец задания % нарушает последовательность технологического маршрута', v_change.task_id;
    end if;
  end loop;

  for v_change in
    select c.*, t.planned_start, t.planned_end, t.version
      from mes_replan_changes c
      join production_tasks t on t.id = c.task_id
  loop
    v_before := jsonb_build_object(
      'plannedStart', v_change.planned_start,
      'plannedEnd', v_change.planned_end,
      'version', v_change.version
    );

    update production_tasks
       set planned_start = v_change.proposed_start,
           planned_end = v_change.proposed_end,
           version = version + 1
     where id = v_change.task_id;

    v_after := jsonb_build_object(
      'plannedStart', v_change.proposed_start,
      'plannedEnd', v_change.proposed_end,
      'version', v_change.version + 1
    );

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
