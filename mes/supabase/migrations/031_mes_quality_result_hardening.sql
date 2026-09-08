-- Quality Gate hardening: reaching planned quantity through a production-result
-- write must never complete a quality-controlled task. Completion remains an
-- explicit lifecycle action after an APPROVED inspection.

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
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  if p_good_quantity < 0 or p_scrap_quantity < 0 or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество выпуска/брака';
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;

  if v_task.status not in ('RUNNING','PAUSED','PARTIALLY_COMPLETED') then
    raise exception 'Факт выпуска можно зарегистрировать только для выполняемого задания';
  end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;

  if mes_current_role() = 'OPERATOR' and not exists (
    select 1
      from task_assignments a
     where a.task_id = p_task_id
       and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  if v_task.actual_quantity + p_good_quantity > v_task.planned_quantity then
    raise exception 'Факт выпуска превышает плановое количество';
  end if;

  v_new_actual := v_task.actual_quantity + p_good_quantity;

  -- A quality-controlled task may reach 100% fact, but it is still only
  -- PARTIALLY_COMPLETED until the separate Quality Gate approves it.
  v_next_status := case
    when v_new_actual >= v_task.planned_quantity
         and (not v_task.quality_required or v_task.quality_status = 'APPROVED')
      then 'COMPLETED'
    when v_new_actual > 0
      then 'PARTIALLY_COMPLETED'
    else v_task.status
  end;

  insert into production_results(
    id,
    task_id,
    recorded_at,
    good_quantity,
    scrap_quantity,
    employee_ids,
    equipment_ids,
    comment
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
         status = v_next_status,
         actual_end = case
           when v_next_status = 'COMPLETED' then coalesce(actual_end, p_recorded_at)
           else actual_end
         end,
         version = version + 1
   where id = p_task_id;

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
      'role', mes_current_role(),
      'qualityRequired', v_task.quality_required,
      'qualityStatus', v_task.quality_status,
      'nextStatus', v_next_status
    )
  );

  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;

comment on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz)
is 'Records production facts without bypassing mandatory Quality Gate completion.';
