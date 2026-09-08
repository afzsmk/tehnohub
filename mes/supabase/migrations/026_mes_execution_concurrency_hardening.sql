-- Harden operational execution against concurrent UI actions and invalid facts.
-- All mutating execution paths lock the operational plan first and the task second,
-- matching assignment/replan order. This makes execution changes deterministic
-- relative to dispatching and replanning.

create or replace function mes_execute_task_action(
  p_task_id text,
  p_action text,
  p_occurred_at timestamptz default now()
)
returns production_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_employee_id text;
  v_plan_id text;
  v_next_status text;
  v_event_type text;
  v_last_event_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR']) then
    raise exception 'Недостаточно прав для выполнения задания';
  end if;
  if p_occurred_at is null then
    raise exception 'Время события не должно быть null';
  end if;

  select o.plan_id
    into v_plan_id
    from production_tasks t
    join production_orders o on o.id = t.order_id
   where t.id = p_task_id;
  if v_plan_id is null then
    raise exception 'Операционный план задания не найден: %', p_task_id;
  end if;

  perform 1 from operational_plans where id = v_plan_id for update;
  if not found then
    raise exception 'Операционный план не найден: %', v_plan_id;
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Задание уже завершено или отменено';
  end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;
  if mes_current_role() = 'OPERATOR' and not exists (
    select 1 from task_assignments a
     where a.task_id = p_task_id and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  v_next_status := case p_action
    when 'START' then 'RUNNING'
    when 'PAUSE' then 'PAUSED'
    when 'RESUME' then 'RUNNING'
    when 'BLOCK' then 'BLOCKED'
    when 'COMPLETE' then 'COMPLETED'
    else null
  end;
  if v_next_status is null then
    raise exception 'Недопустимое действие: %', p_action;
  end if;

  if not can_transition_status(v_task.status, v_next_status) then
    raise exception 'Недопустимый переход % -> % для действия %', v_task.status, v_next_status, p_action;
  end if;

  if p_action = 'START' and v_task.status <> 'READY' then
    raise exception 'Запуск разрешён только для подготовленного задания (READY)';
  end if;

  if p_action = 'COMPLETE' and v_task.actual_quantity < v_task.planned_quantity then
    raise exception 'Нельзя завершить задание: зарегистрирован не весь плановый выпуск';
  end if;

  if v_task.actual_start is not null and p_occurred_at < v_task.actual_start then
    raise exception 'Время события раньше фактического начала задания';
  end if;

  select max(e.occurred_at)
    into v_last_event_at
    from production_events e
   where e.task_id = p_task_id;
  if v_last_event_at is not null and p_occurred_at < v_last_event_at then
    raise exception 'Время события раньше последнего события задания';
  end if;

  update production_tasks
     set status = v_next_status,
         actual_start = case when p_action = 'START' then coalesce(actual_start, p_occurred_at) else actual_start end,
         actual_end = case when p_action = 'COMPLETE' then p_occurred_at else actual_end end,
         version = version + 1
   where id = p_task_id
   returning * into v_task;

  v_event_type := case p_action
    when 'START' then 'TASK_STARTED'
    when 'PAUSE' then 'TASK_PAUSED'
    when 'RESUME' then 'TASK_RESUMED'
    when 'BLOCK' then 'TASK_PAUSED'
    when 'COMPLETE' then 'TASK_COMPLETED'
  end;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    v_event_type,
    p_occurred_at,
    auth.uid()::text,
    jsonb_build_object(
      'action', p_action,
      'status', v_next_status,
      'employeeId', v_employee_id,
      'role', mes_current_role()
    )
  );

  return v_task;
end;
$$;

grant execute on function mes_execute_task_action(text,text,timestamptz) to authenticated;

create or replace function mes_record_production_result(
  p_task_id text,
  p_good_quantity numeric,
  p_scrap_quantity numeric,
  p_equipment_ids jsonb default '[]'::jsonb,
  p_comment text default null,
  p_recorded_at timestamptz default now()
)
returns production_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_employee_id text;
  v_plan_id text;
  v_result production_results%rowtype;
  v_new_actual numeric;
  v_next_status text;
  v_equipment_id text;
  v_unique_equipment text[];
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR']) then
    raise exception 'Недостаточно прав для регистрации выпуска';
  end if;
  if p_good_quantity is null or p_scrap_quantity is null
     or p_good_quantity < 0 or p_scrap_quantity < 0
     or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество выпуска/брака';
  end if;
  if p_recorded_at is null then
    raise exception 'Время регистрации не должно быть null';
  end if;
  if p_equipment_ids is not null and jsonb_typeof(p_equipment_ids) <> 'array' then
    raise exception 'equipmentIds должен быть массивом или null';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_equipment_ids, '[]'::jsonb)) item
     where jsonb_typeof(item) <> 'string'
  ) then
    raise exception 'equipmentIds должен содержать только строки';
  end if;

  select o.plan_id
    into v_plan_id
    from production_tasks t
    join production_orders o on o.id = t.order_id
   where t.id = p_task_id;
  if v_plan_id is null then
    raise exception 'Операционный план задания не найден: %', p_task_id;
  end if;

  perform 1 from operational_plans where id = v_plan_id for update;
  if not found then
    raise exception 'Операционный план не найден: %', v_plan_id;
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;
  if v_task.status in ('CANCELLED','DRAFT','PLANNED','ASSIGNED','READY') then
    raise exception 'Регистрация выпуска разрешена только для выполняемого задания';
  end if;
  if v_task.status = 'COMPLETED' then
    raise exception 'Нельзя регистрировать выпуск для уже завершённого задания';
  end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;
  if mes_current_role() = 'OPERATOR' and not exists (
    select 1 from task_assignments a
     where a.task_id = p_task_id and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::text[])
    into v_unique_equipment
    from jsonb_array_elements_text(coalesce(p_equipment_ids, '[]'::jsonb)) as value
   where trim(value) <> '';

  foreach v_equipment_id in array v_unique_equipment loop
    if not exists (
      select 1 from task_assignments a
       where a.task_id = p_task_id and a.equipment_id = v_equipment_id
    ) then
      raise exception 'Оборудование % не назначено на это задание', v_equipment_id;
    end if;
    if not exists (select 1 from equipment e where e.id = v_equipment_id and e.active) then
      raise exception 'Оборудование % неактивно или не найдено', v_equipment_id;
    end if;
  end loop;

  if v_task.actual_start is not null and p_recorded_at < v_task.actual_start then
    raise exception 'Время выпуска раньше фактического начала задания';
  end if;

  if v_task.actual_quantity + p_good_quantity > v_task.planned_quantity then
    raise exception 'Факт выпуска превышает плановое количество';
  end if;

  v_new_actual := v_task.actual_quantity + p_good_quantity;
  v_next_status := case
    when v_new_actual >= v_task.planned_quantity then 'COMPLETED'
    else 'PARTIALLY_COMPLETED'
  end;

  if v_task.status = 'RUNNING' and v_next_status not in ('PARTIALLY_COMPLETED','COMPLETED') then
    raise exception 'Некорректное состояние после регистрации выпуска';
  end if;
  if v_task.status = 'PAUSED' and v_next_status not in ('PARTIALLY_COMPLETED','COMPLETED') then
    raise exception 'Возобновите задание перед регистрацией выпуска';
  end if;

  insert into production_results(
    id, task_id, recorded_at, good_quantity, scrap_quantity,
    employee_ids, equipment_ids, comment
  ) values (
    concat('RES-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    p_recorded_at,
    p_good_quantity,
    p_scrap_quantity,
    case when v_employee_id is null then '[]'::jsonb else jsonb_build_array(v_employee_id) end,
    to_jsonb(v_unique_equipment),
    nullif(p_comment, '')
  ) returning * into v_result;

  update production_tasks
     set actual_quantity = v_new_actual,
         status = v_next_status,
         actual_end = case when v_new_actual >= planned_quantity then coalesce(actual_end, p_recorded_at) else actual_end end,
         version = version + 1
   where id = p_task_id
   returning * into v_task;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    'RESULT_RECORDED',
    p_recorded_at,
    auth.uid()::text,
    jsonb_build_object(
      'resultId', v_result.id,
      'goodQuantity', p_good_quantity,
      'scrapQuantity', p_scrap_quantity,
      'employeeId', v_employee_id,
      'equipmentIds', to_jsonb(v_unique_equipment),
      'role', mes_current_role()
    )
  );

  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;

create or replace function mes_start_downtime(
  p_equipment_id text,
  p_reason_code text,
  p_comment text default null,
  p_started_at timestamptz default now()
)
returns downtime_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event downtime_events%rowtype;
  v_employee_id text;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR','MAINTENANCE']) then
    raise exception 'Недостаточно прав для регистрации простоя';
  end if;
  if p_equipment_id is null or trim(p_equipment_id) = '' then
    raise exception 'Оборудование должно быть указано';
  end if;
  if p_reason_code is null or trim(p_reason_code) = '' then
    raise exception 'Причина простоя должна быть указана';
  end if;
  if p_started_at is null then
    raise exception 'Время начала простоя не должно быть null';
  end if;

  -- Serialize open-downtime creation on the equipment itself.
  perform 1 from equipment where id = p_equipment_id and active for update;
  if not found then
    raise exception 'Оборудование не найдено или неактивно';
  end if;

  if exists (
    select 1 from downtime_events
     where equipment_id = p_equipment_id and ended_at is null
  ) then
    raise exception 'Для оборудования уже зарегистрирован открытый простой';
  end if;

  v_employee_id := mes_current_employee_id();

  insert into downtime_events(id, equipment_id, reason_code, started_at, comment)
  values (
    concat('DT-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_equipment_id,
    trim(p_reason_code),
    p_started_at,
    case
      when v_employee_id is null then nullif(p_comment, '')
      else concat(coalesce(nullif(p_comment, ''), ''), case when nullif(p_comment, '') is null then '' else ' ' end, '[employeeId=', v_employee_id, ']')
    end
  ) returning * into v_event;

  insert into production_events(id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    'DOWNTIME_STARTED',
    p_started_at,
    auth.uid()::text,
    jsonb_build_object(
      'downtimeId', v_event.id,
      'equipmentId', p_equipment_id,
      'reasonCode', trim(p_reason_code),
      'employeeId', v_employee_id,
      'role', mes_current_role()
    )
  );

  return v_event;
end;
$$;

grant execute on function mes_start_downtime(text,text,text,timestamptz) to authenticated;

create or replace function mes_end_downtime(
  p_downtime_id text,
  p_ended_at timestamptz default now()
)
returns downtime_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event downtime_events%rowtype;
  v_employee_id text;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR','MAINTENANCE']) then
    raise exception 'Недостаточно прав для завершения простоя';
  end if;
  if p_ended_at is null then
    raise exception 'Время окончания простоя не должно быть null';
  end if;

  select * into v_event
    from downtime_events
   where id = p_downtime_id
   for update;
  if not found then
    raise exception 'Простой не найден: %', p_downtime_id;
  end if;
  if v_event.ended_at is not null then
    raise exception 'Простой уже закрыт';
  end if;
  if p_ended_at < v_event.started_at then
    raise exception 'Время окончания простоя раньше времени начала';
  end if;

  -- Lock equipment too, matching start-downtime serialization.
  perform 1 from equipment where id = v_event.equipment_id for update;

  v_employee_id := mes_current_employee_id();

  update downtime_events
     set ended_at = p_ended_at
   where id = p_downtime_id
   returning * into v_event;

  insert into production_events(id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    'DOWNTIME_ENDED',
    p_ended_at,
    auth.uid()::text,
    jsonb_build_object(
      'downtimeId', v_event.id,
      'equipmentId', v_event.equipment_id,
      'employeeId', v_employee_id,
      'role', mes_current_role()
    )
  );

  return v_event;
end;
$$;

grant execute on function mes_end_downtime(text,timestamptz) to authenticated;
