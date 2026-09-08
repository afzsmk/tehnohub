-- MES Quality Gate v1.
-- Quality is evaluated before a task becomes COMPLETED. Production facts remain append-only.

alter table production_tasks
  add column if not exists quality_required boolean not null default false,
  add column if not exists quality_status text not null default 'NOT_REQUIRED';

alter table production_tasks
  drop constraint if exists production_tasks_quality_status_check;

alter table production_tasks
  add constraint production_tasks_quality_status_check
  check (quality_status in ('NOT_REQUIRED','PENDING','APPROVED','REJECTED'));

create table if not exists quality_inspections (
  id text primary key,
  task_id text not null references production_tasks(id),
  inspected_at timestamptz not null default now(),
  inspector_id text not null,
  status text not null check (status in ('PENDING','APPROVED','REJECTED')),
  good_quantity numeric(18,3) not null default 0 check (good_quantity >= 0),
  scrap_quantity numeric(18,3) not null default 0 check (scrap_quantity >= 0),
  defect_code text,
  comment text
);

create index if not exists idx_quality_inspections_task
  on quality_inspections(task_id, inspected_at desc);

create or replace function mes_request_quality_check(p_task_id text)
returns production_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_before text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MASTER','OPERATOR','QUALITY']) then
    raise exception 'Недостаточно прав для запроса ОТК';
  end if;

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if not v_task.quality_required then return v_task; end if;
  if v_task.status not in ('RUNNING','PARTIALLY_COMPLETED') then
    raise exception 'Запрос ОТК допустим только для выполняемого задания';
  end if;

  v_before := v_task.quality_status;
  update production_tasks
     set quality_status = 'PENDING', version = version + 1
   where id = p_task_id
   returning * into v_task;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (auth.uid()::text, 'PRODUCTION_TASK', p_task_id, 'QUALITY_CHECK_REQUESTED',
          jsonb_build_object('qualityStatus', v_before),
          jsonb_build_object('qualityRequired', true, 'qualityStatus', 'PENDING', 'version', v_task.version));
  return v_task;
end;
$$;

grant execute on function mes_request_quality_check(text) to authenticated;

create or replace function mes_submit_quality_inspection(
  p_task_id text,
  p_status text,
  p_good_quantity numeric default 0,
  p_scrap_quantity numeric default 0,
  p_defect_code text default null,
  p_comment text default null,
  p_inspected_at timestamptz default now()
)
returns quality_inspections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_inspection quality_inspections%rowtype;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if mes_current_role() not in ('QUALITY','ADMIN','PRODUCTION_MANAGER') then
    raise exception 'Только ОТК может вынести решение по качеству';
  end if;
  if p_status not in ('APPROVED','REJECTED') then raise exception 'Недопустимый статус ОТК'; end if;
  if p_good_quantity < 0 or p_scrap_quantity < 0 or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество результата ОТК';
  end if;

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if not v_task.quality_required then raise exception 'Для задания ОТК не требуется'; end if;
  if v_task.quality_status <> 'PENDING' then raise exception 'Задание не ожидает решения ОТК'; end if;

  if p_status = 'APPROVED' and p_scrap_quantity > 0 then
    raise exception 'При APPROVED количество брака должно быть 0';
  end if;
  if p_status = 'REJECTED' and coalesce(nullif(trim(p_defect_code), ''), '') = '' then
    raise exception 'Для отклонения ОТК требуется код дефекта';
  end if;

  insert into quality_inspections(
    id, task_id, inspected_at, inspector_id, status,
    good_quantity, scrap_quantity, defect_code, comment
  ) values (
    concat('QI-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id, p_inspected_at, auth.uid()::text, p_status,
    p_good_quantity, p_scrap_quantity, nullif(trim(p_defect_code), ''), nullif(p_comment, '')
  ) returning * into v_inspection;

  update production_tasks
     set quality_status = p_status,
         version = version + 1
   where id = p_task_id;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    'RESULT_RECORDED',
    p_inspected_at,
    auth.uid()::text,
    jsonb_build_object('qualityInspectionId', v_inspection.id, 'qualityStatus', p_status, 'defectCode', v_inspection.defect_code, 'role', mes_current_role())
  );

  return v_inspection;
end;
$$;

grant execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) to authenticated;

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
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('COMPLETED','CANCELLED') then raise exception 'Задание уже завершено или отменено'; end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then raise exception 'Пользователь MES не привязан к сотруднику'; end if;
  if mes_current_role() = 'OPERATOR' and not exists (select 1 from task_assignments a where a.task_id = p_task_id and a.employee_id = v_employee_id) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  v_next_status := case p_action when 'START' then 'RUNNING' when 'PAUSE' then 'PAUSED' when 'RESUME' then 'RUNNING' when 'BLOCK' then 'BLOCKED' when 'COMPLETE' then 'COMPLETED' else null end;
  if v_next_status is null then raise exception 'Недопустимое действие: %', p_action; end if;
  if not can_transition_status(v_task.status, v_next_status) then raise exception 'Недопустимый переход % -> % для действия %', v_task.status, v_next_status, p_action; end if;
  if p_action = 'START' and v_task.status <> 'READY' then raise exception 'Запуск разрешён только для подготовленного задания (READY)'; end if;
  if p_action = 'COMPLETE' and v_task.quality_required and v_task.quality_status <> 'APPROVED' then
    raise exception 'Нельзя завершить задание без одобрения ОТК';
  end if;

  update production_tasks
     set status = v_next_status,
         actual_start = case when p_action = 'START' then coalesce(actual_start, p_occurred_at) else actual_start end,
         actual_end = case when p_action = 'COMPLETE' then p_occurred_at else actual_end end,
         quality_status = case when p_action = 'START' and quality_required and quality_status = 'NOT_REQUIRED' then 'PENDING' else quality_status end,
         version = version + 1
   where id = p_task_id
   returning * into v_task;

  v_event_type := case p_action when 'START' then 'TASK_STARTED' when 'PAUSE' then 'TASK_PAUSED' when 'RESUME' then 'TASK_RESUMED' when 'BLOCK' then 'TASK_PAUSED' when 'COMPLETE' then 'TASK_COMPLETED' end;
  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)), p_task_id, v_event_type, p_occurred_at, auth.uid()::text,
          jsonb_build_object('action', p_action, 'status', v_next_status, 'employeeId', v_employee_id, 'role', mes_current_role()));
  return v_task;
end;
$$;

grant execute on function mes_execute_task_action(text,text,timestamptz) to authenticated;

comment on table quality_inspections is 'MES quality-control decisions; append-only inspection history.';
