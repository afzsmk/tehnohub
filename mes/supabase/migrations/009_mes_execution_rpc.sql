-- Execute task actions and register production facts through SECURITY DEFINER RPCs.
-- The browser supplies intent, while actor/employee identity comes from auth.uid()
-- and mes_user_employee. Production history remains append-only.

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
  v_next_status text;
  v_event_type text;
begin
  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('COMPLETED','CANCELLED') then raise exception 'Задание уже завершено или отменено'; end if;

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
    else null end;
  if v_next_status is null then raise exception 'Недопустимое действие: %', p_action; end if;

  if v_task.status = 'PLANNED' and p_action = 'START' then
    raise exception 'Задание должно быть назначено и подготовлено перед запуском';
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
    when 'COMPLETE' then 'TASK_COMPLETED' end;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    v_event_type,
    p_occurred_at,
    auth.uid()::text,
    jsonb_build_object('action', p_action, 'status', v_next_status, 'employeeId', v_employee_id, 'role', mes_current_role())
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
  v_result production_results%rowtype;
  v_new_actual numeric;
  v_next_status text;
begin
  if p_good_quantity < 0 or p_scrap_quantity < 0 or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество выпуска/брака';
  end if;

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('CANCELLED','DRAFT') then raise exception 'Нельзя регистрировать факт для этого задания'; end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;
  if mes_current_role() = 'OPERATOR' and not exists (
    select 1 from task_assignments a where a.task_id = p_task_id and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  if v_task.actual_quantity + p_good_quantity > v_task.planned_quantity then
    raise exception 'Факт выпуска превышает плановое количество';
  end if;

  v_new_actual := v_task.actual_quantity + p_good_quantity;
  v_next_status := case when v_new_actual >= v_task.planned_quantity then 'COMPLETED' else 'PARTIALLY_COMPLETED' end;

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
    coalesce(p_equipment_ids, '[]'::jsonb),
    nullif(p_comment, '')
  ) returning * into v_result;

  update production_tasks
     set actual_quantity = v_new_actual,
         status = case when can_transition_status(status, v_next_status) then v_next_status else status end,
         actual_end = case when v_new_actual >= planned_quantity then coalesce(actual_end, p_recorded_at) else actual_end end,
         version = version + 1
   where id = p_task_id;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    'RESULT_RECORDED',
    p_recorded_at,
    auth.uid()::text,
    jsonb_build_object('resultId', v_result.id, 'goodQuantity', p_good_quantity, 'scrapQuantity', p_scrap_quantity, 'employeeId', v_employee_id, 'role', mes_current_role())
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
  if not exists (select 1 from equipment e where e.id = p_equipment_id and e.active) then
    raise exception 'Оборудование не найдено или неактивно';
  end if;
  if exists (select 1 from downtime_events where equipment_id = p_equipment_id and ended_at is null) then
    raise exception 'Для оборудования уже зарегистрирован открытый простой';
  end if;
  v_employee_id := mes_current_employee_id();
  insert into downtime_events(id, equipment_id, reason_code, started_at, comment)
  values (
    concat('DT-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_equipment_id, p_reason_code, p_started_at,
    case when v_employee_id is null then p_comment else concat(coalesce(p_comment, ''), case when coalesce(p_comment,'') = '' then '' else ' ' end, '[employeeId=', v_employee_id, ']') end
  ) returning * into v_event;
  insert into production_events(id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    'DOWNTIME_STARTED', p_started_at, auth.uid()::text,
    jsonb_build_object('downtimeId', v_event.id, 'equipmentId', p_equipment_id, 'reasonCode', p_reason_code, 'employeeId', v_employee_id, 'role', mes_current_role())
  );
  return v_event;
end;
$$;

grant execute on function mes_start_downtime(text,text,text,timestamptz) to authenticated;
