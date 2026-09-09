-- MES end-to-end production -> quality -> completion integrity.
-- An approved full-quantity inspection atomically completes the task and
-- refreshes the order fact. Partial approved production remains PARTIALLY_COMPLETED.

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
  v_before_status text;
  v_inspection quality_inspections%rowtype;
  v_completed_task production_tasks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if mes_current_role() not in ('QUALITY','ADMIN','PRODUCTION_MANAGER') then
    raise exception 'Только ОТК может вынести решение по качеству';
  end if;
  if p_status not in ('APPROVED','REJECTED') then
    raise exception 'Недопустимый статус ОТК';
  end if;
  if p_good_quantity < 0 or p_scrap_quantity < 0 or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество результата ОТК';
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;
  if not v_task.quality_required then
    raise exception 'Для задания ОТК не требуется';
  end if;
  if v_task.quality_status <> 'PENDING' then
    raise exception 'Задание не ожидает решения ОТК';
  end if;
  if v_task.status not in ('RUNNING','PAUSED','PARTIALLY_COMPLETED') then
    raise exception 'Решение ОТК допустимо только для выполняемого задания';
  end if;

  if p_status = 'APPROVED' then
    if p_scrap_quantity <> 0 then
      raise exception 'При APPROVED количество брака должно быть 0';
    end if;
    if p_good_quantity <> v_task.actual_quantity then
      raise exception 'При APPROVED количество годных изделий должно совпадать с фактом задания: %', v_task.actual_quantity;
    end if;
  else
    if coalesce(nullif(trim(p_defect_code), ''), '') = '' then
      raise exception 'Для отклонения ОТК требуется код дефекта';
    end if;
  end if;

  v_before_status := v_task.status;

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
         status = case
           when p_status = 'APPROVED'
            and v_task.actual_quantity >= v_task.planned_quantity
            and v_task.status in ('RUNNING','PAUSED','PARTIALLY_COMPLETED')
             then 'COMPLETED'
           else status
         end,
         actual_end = case
           when p_status = 'APPROVED'
            and v_task.actual_quantity >= v_task.planned_quantity
            and v_task.status in ('RUNNING','PAUSED','PARTIALLY_COMPLETED')
             then p_inspected_at
           else actual_end
         end,
         version = version + 1
   where id = p_task_id
   returning * into v_completed_task;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    'RESULT_RECORDED',
    p_inspected_at,
    auth.uid()::text,
    jsonb_build_object(
      'qualityInspectionId', v_inspection.id,
      'qualityStatus', p_status,
      'defectCode', v_inspection.defect_code,
      'goodQuantity', p_good_quantity,
      'scrapQuantity', p_scrap_quantity,
      'role', mes_current_role(),
      'taskStatusBefore', v_before_status,
      'taskStatusAfter', v_completed_task.status,
      'autoCompleted', v_completed_task.status = 'COMPLETED'
    )
  );

  if v_completed_task.status = 'COMPLETED' then
    insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
    values (
      concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
      p_task_id,
      'TASK_COMPLETED',
      p_inspected_at,
      auth.uid()::text,
      jsonb_build_object(
        'source', 'QUALITY_APPROVAL',
        'qualityInspectionId', v_inspection.id,
        'actualQuantity', v_completed_task.actual_quantity,
        'plannedQuantity', v_completed_task.planned_quantity
      )
    );

    -- Keep order plan/fact synchronization in the same DB transaction.
    perform mes_sync_order_from_task(v_completed_task.order_id);
  end if;

  return v_inspection;
end;
$$;

grant execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) to authenticated;

comment on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) is
'Accepts/rejects mandatory MES quality inspection; APPROVED full quantity atomically completes the task and synchronizes the order fact.';
