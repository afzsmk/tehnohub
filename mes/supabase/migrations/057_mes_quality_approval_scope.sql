-- MES quality approval scope hardening.
-- A prior APPROVED inspection only covers the exact quantity that was inspected.
-- New production beyond that quantity invalidates the prior approval and keeps the
-- task partial until the expanded quantity is inspected and approved.

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
  v_approved_quantity numeric := 0;
  v_quality_covers_actual boolean := false;
  v_next_status text;
  v_next_quality_status text;
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

  if v_task.quality_required and v_task.quality_status = 'APPROVED' then
    select coalesce(sum(q.good_quantity), 0)
      into v_approved_quantity
      from quality_inspections q
     where q.task_id = p_task_id
       and q.status = 'APPROVED'
       and q.inspected_at = (
         select max(q2.inspected_at)
           from quality_inspections q2
          where q2.task_id = p_task_id
            and q2.status = 'APPROVED'
       );
    v_quality_covers_actual := v_approved_quantity >= v_new_actual;
  end if;

  -- Production may reach the planned quantity before the final quality decision.
  -- The prior APPROVED snapshot does not authorize newly produced quantity beyond
  -- what was inspected, so the task remains PARTIALLY_COMPLETED and waits for a
  -- new PENDING quality decision.
  v_next_status := case
    when v_new_actual >= v_task.planned_quantity
         and (not v_task.quality_required or v_quality_covers_actual)
      then 'COMPLETED'
    when v_new_actual > 0
      then 'PARTIALLY_COMPLETED'
    else v_task.status
  end;

  v_next_quality_status := case
    when v_task.quality_required
         and v_task.quality_status = 'APPROVED'
         and not v_quality_covers_actual
      then 'PENDING'
    else v_task.quality_status
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
         quality_status = v_next_quality_status,
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
      'qualityStatusBefore', v_task.quality_status,
      'qualityStatusAfter', v_next_quality_status,
      'approvedQuantityBefore', v_approved_quantity,
      'nextStatus', v_next_status
    )
  );

  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;

comment on function mes_record_production_result(text,numeric,numeric,jsonb,text,text,timestamptz) is
'Production facts cannot rely on stale partial quality approval; newly produced quantity beyond the approved snapshot reopens the Quality Gate.';
