-- Align database execution transitions with the MES lifecycle.
-- Server validation must not allow an operator to skip READY or perform
-- transitions that the UI lifecycle forbids.

create or replace function can_transition_status(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case
    when p_from = 'DRAFT' and p_to = 'PLANNED' then true
    when p_from = 'PLANNED' and p_to = 'ASSIGNED' then true
    when p_from = 'ASSIGNED' and p_to = 'READY' then true
    when p_from = 'READY' and p_to = 'RUNNING' then true
    when p_from = 'RUNNING' and p_to = 'PAUSED' then true
    when p_from = 'RUNNING' and p_to = 'BLOCKED' then true
    when p_from = 'RUNNING' and p_to = 'PARTIALLY_COMPLETED' then true
    when p_from = 'RUNNING' and p_to = 'COMPLETED' then true
    when p_from = 'PAUSED' and p_to = 'RUNNING' then true
    when p_from = 'PAUSED' and p_to = 'BLOCKED' then true
    when p_from = 'BLOCKED' and p_to = 'READY' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'RUNNING' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'BLOCKED' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'COMPLETED' then true
    else false
  end
$$;

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

  if not can_transition_status(v_task.status, v_next_status) then
    raise exception 'Недопустимый переход % -> % для действия %', v_task.status, v_next_status, p_action;
  end if;

  if p_action = 'START' and v_task.status <> 'READY' then
    raise exception 'Запуск разрешён только для подготовленного задания (READY)';
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
