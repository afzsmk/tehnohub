-- Keep Quality Gate mutations on the same lock order as execution/replan:
-- operational plan first, production task second. This prevents a concurrent
-- quality decision from taking the task lock and then waiting behind a plan lock.

create or replace function mes_submit_quality_inspection(
  p_task_id text,
  p_status text,
  p_good_quantity numeric default 0,
  p_scrap_quantity numeric default 0,
  p_defect_code text default null,
  p_comment text default null,
  p_inspected_at timestamptz default now(),
  p_idempotency_key text default null
)
returns quality_inspections
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id text;
  v_task production_tasks%rowtype;
  v_before_status text;
  v_inspection quality_inspections%rowtype;
  v_existing quality_inspections%rowtype;
  v_completed_task production_tasks%rowtype;
  v_key text := nullif(btrim(p_idempotency_key), '');
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
  if p_good_quantity is null or p_scrap_quantity is null
     or p_good_quantity < 0 or p_scrap_quantity < 0
     or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество результата ОТК';
  end if;
  if p_inspected_at is null then
    raise exception 'Время проверки не должно быть null';
  end if;
  if v_key is not null and length(v_key) > 200 then
    raise exception 'Ключ идемпотентности слишком длинный';
  end if;

  if v_key is not null then
    select * into v_existing
      from quality_inspections
     where idempotency_key = v_key;
    if found then
      if v_existing.task_id <> p_task_id
         or v_existing.status <> p_status
         or v_existing.good_quantity <> p_good_quantity
         or v_existing.scrap_quantity <> p_scrap_quantity
         or coalesce(v_existing.defect_code, '') <> coalesce(nullif(trim(p_defect_code), ''), '') then
        raise exception 'Ключ идемпотентности уже используется для другого решения ОТК';
      end if;
      return v_existing;
    end if;
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
  if not v_task.quality_required then
    raise exception 'Для задания ОТК не требуется';
  end if;
  if v_task.quality_status <> 'PENDING' then
    raise exception 'Задание не ожидает решения ОТК';
  end if;
  if v_task.status not in ('RUNNING','PAUSED','PARTIALLY_COMPLETED') then
    raise exception 'Решение ОТК допустимо только для выполняемого задания';
  end if;
  if v_task.actual_start is not null and p_inspected_at < v_task.actual_start then
    raise exception 'Время проверки раньше фактического начала задания';
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
    good_quantity, scrap_quantity, defect_code, comment, idempotency_key
  ) values (
    concat('QI-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id, p_inspected_at, auth.uid()::text, p_status,
    p_good_quantity, p_scrap_quantity,
    nullif(trim(p_defect_code), ''), nullif(p_comment, ''), v_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_inspection;

  if v_inspection.id is null then
    select * into v_existing
      from quality_inspections
     where idempotency_key = v_key;
    if not found then
      raise exception 'MES: идемпотентное решение ОТК не найдено после конфликтной вставки';
    end if;
    if v_existing.task_id <> p_task_id
       or v_existing.status <> p_status
       or v_existing.good_quantity <> p_good_quantity
       or v_existing.scrap_quantity <> p_scrap_quantity
       or coalesce(v_existing.defect_code, '') <> coalesce(nullif(trim(p_defect_code), ''), '') then
      raise exception 'Ключ идемпотентности уже используется для другого решения ОТК';
    end if;
    return v_existing;
  end if;

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
      'autoCompleted', v_completed_task.status = 'COMPLETED',
      'idempotencyKey', v_key
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

    perform mes_sync_order_from_task(v_completed_task.order_id);
  end if;

  return v_inspection;
end;
$$;

revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) from public;
revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) from anon;
grant execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) to authenticated;
