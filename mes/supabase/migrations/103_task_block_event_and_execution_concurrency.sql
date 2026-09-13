-- Finalize task blocking semantics and restore execution concurrency guarantees.
-- BLOCK is a distinct business event, not a PAUSE alias.
-- Execution mutations serialize on the operational plan before locking the task.

alter table production_events
  drop constraint if exists production_events_type_check;

alter table production_events
  add constraint production_events_type_check check (
    type in (
      'TASK_STARTED','TASK_PAUSED','TASK_RESUMED','TASK_BLOCKED','TASK_COMPLETED',
      'RESULT_RECORDED','DOWNTIME_STARTED','DOWNTIME_ENDED',
      'MAINTENANCE_STARTED','MAINTENANCE_COMPLETED'
    )
  );

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
  v_from_status text;
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

  perform 1
    from operational_plans
   where id = v_plan_id
   for update;
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

  v_from_status := v_task.status;
  if v_from_status in ('COMPLETED','CANCELLED') then
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

  if not can_transition_status(v_from_status, v_next_status) then
    raise exception 'Недопустимый переход задания: % -> %', v_from_status, v_next_status;
  end if;

  if p_action = 'START' and v_from_status <> 'READY' then
    raise exception 'Запуск разрешён только для подготовленного задания (READY)';
  end if;
  if p_action = 'START' and not exists (
    select 1 from task_assignments a where a.task_id = p_task_id
  ) then
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
         actual_start = case
           when p_action = 'START' then coalesce(actual_start, p_occurred_at)
           else actual_start
         end,
         actual_end = case
           when p_action = 'COMPLETE' then p_occurred_at
           else actual_end
         end,
         version = version + 1
   where id = p_task_id
   returning * into v_task;

  v_event_type := case p_action
    when 'START' then 'TASK_STARTED'
    when 'PAUSE' then 'TASK_PAUSED'
    when 'RESUME' then 'TASK_RESUMED'
    when 'BLOCK' then 'TASK_BLOCKED'
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
      'fromStatus', v_from_status,
      'status', v_next_status,
      'employeeId', v_employee_id,
      'role', mes_current_role()
    )
  );

  return v_task;
end;
$$;

grant execute on function mes_execute_task_action(text,text,timestamptz) to authenticated;
