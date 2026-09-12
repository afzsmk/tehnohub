-- Follow-up corrections to 093: preserve the source status in the event payload
-- and make JSON validation independent of PostgreSQL expression evaluation order.

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
  v_from_status text;
  v_next_status text;
  v_event_type text;
begin
  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;

  v_from_status := v_task.status;
  v_employee_id := mes_current_employee_id();

  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;
  if mes_current_role() = 'OPERATOR' and not exists (
    select 1 from task_assignments a where a.task_id = p_task_id and a.employee_id = v_employee_id
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
  if v_next_status is null then raise exception 'Недопустимое действие: %', p_action; end if;
  if not can_transition_status(v_from_status, v_next_status) then
    raise exception 'Недопустимый переход задания: % -> %', v_from_status, v_next_status;
  end if;

  if p_action = 'START' and not exists (select 1 from task_assignments a where a.task_id = p_task_id) then
    raise exception 'Нельзя запустить задание без назначенных ресурсов';
  end if;
  if p_action = 'COMPLETE' then
    if v_task.actual_quantity < v_task.planned_quantity then
      raise exception 'Нельзя завершить задание: фактический выпуск меньше планового';
    end if;
    if coalesce(v_task.quality_required, false)
       and coalesce(v_task.quality_status, 'NOT_REQUIRED') <> 'APPROVED' then
      raise exception 'Нельзя завершить задание без одобренного ОТК';
    end if;
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
    jsonb_build_object('action', p_action, 'fromStatus', v_from_status, 'status', v_next_status,
                       'employeeId', v_employee_id, 'role', mes_current_role())
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
  v_quality_gate boolean;
  v_equipment_id text;
begin
  if p_good_quantity is null or p_scrap_quantity is null
     or p_good_quantity < 0 or p_scrap_quantity < 0
     or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество выпуска/брака';
  end if;

  if jsonb_typeof(coalesce(p_equipment_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'Идентификаторы оборудования должны быть строковым JSON-массивом';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_equipment_ids, '[]'::jsonb)) value
    where value is null
  ) then
    raise exception 'Идентификаторы оборудования должны быть строками';
  end if;

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status not in ('RUNNING','PARTIALLY_COMPLETED') then
    raise exception 'Регистрация факта разрешена только для выполняемого задания';
  end if;

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

  for v_equipment_id in select value from jsonb_array_elements_text(coalesce(p_equipment_ids, '[]'::jsonb))
  loop
    if not exists (
      select 1 from task_assignments a where a.task_id = p_task_id and a.equipment_id = v_equipment_id
    ) then
      raise exception 'Оборудование % не назначено на это задание', v_equipment_id;
    end if;
    if not exists (select 1 from equipment e where e.id = v_equipment_id and e.active) then
      raise exception 'Оборудование % неактивно или не найдено', v_equipment_id;
    end if;
  end loop;

  v_new_actual := v_task.actual_quantity + p_good_quantity;
  v_quality_gate := coalesce(v_task.quality_required, false) and coalesce(v_task.quality_status, 'NOT_REQUIRED') <> 'APPROVED';

  insert into production_results(id, task_id, recorded_at, good_quantity, scrap_quantity,
                                 employee_ids, equipment_ids, comment)
  values (
    concat('RES-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id, p_recorded_at, p_good_quantity, p_scrap_quantity,
    case when v_employee_id is null then '[]'::jsonb else jsonb_build_array(v_employee_id) end,
    coalesce(p_equipment_ids, '[]'::jsonb), nullif(p_comment, '')
  ) returning * into v_result;

  update production_tasks
     set actual_quantity = v_new_actual,
         status = case
           when v_new_actual >= planned_quantity and v_quality_gate then 'PARTIALLY_COMPLETED'
           when v_new_actual >= planned_quantity then 'COMPLETED'
           else 'PARTIALLY_COMPLETED'
         end,
         actual_end = case when v_new_actual >= planned_quantity and not v_quality_gate
                            then coalesce(actual_end, p_recorded_at) else actual_end end,
         quality_status = case when v_quality_gate or coalesce(quality_required, false) then 'PENDING' else quality_status end,
         version = version + 1
   where id = p_task_id;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id, 'RESULT_RECORDED', p_recorded_at, auth.uid()::text,
    jsonb_build_object('resultId', v_result.id, 'goodQuantity', p_good_quantity,
                       'scrapQuantity', p_scrap_quantity, 'employeeId', v_employee_id,
                       'equipmentIds', coalesce(p_equipment_ids, '[]'::jsonb), 'role', mes_current_role())
  );
  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;
