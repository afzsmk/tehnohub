-- MES workflow transaction hardening.
-- Production facts, task completion, order plan/fact sync and upstream outbox
-- must remain consistent while quality-only journal events must not masquerade
-- as production facts for Workforce.

-- 1. Rebuild the Workforce outbox trigger so a quality inspection journal event
--    is not emitted as an ACTUAL result. Production result events carry resultId.
create or replace function mes_enqueue_workforce_event_from_production_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id text;
  v_plan_id text;
  v_plan_version integer;
  v_product_external_id text;
  v_equipment_external_id text;
  v_quantity_good numeric;
  v_quantity_scrap numeric;
  v_result_id text;
  v_event_type text;
  v_payload jsonb;
begin
  if NEW.type not in ('TASK_COMPLETED','RESULT_RECORDED','DOWNTIME_STARTED','DOWNTIME_ENDED','MAINTENANCE_STARTED','MAINTENANCE_COMPLETED') then
    return NEW;
  end if;

  -- Quality inspections use the existing append-only journal event type for
  -- compatibility, but are not production-result messages to Workforce.
  if NEW.type = 'RESULT_RECORDED' and coalesce(NEW.payload->>'source','') = 'QUALITY_INSPECTION' then
    return NEW;
  end if;

  if NEW.type = 'TASK_COMPLETED' then
    v_event_type := 'TASK_COMPLETED';
  elsif NEW.type = 'RESULT_RECORDED' then
    v_event_type := 'RESULT_RECORDED';
  elsif NEW.type in ('DOWNTIME_STARTED','DOWNTIME_ENDED') then
    v_event_type := 'DOWNTIME';
  else
    v_event_type := 'MAINTENANCE';
  end if;

  if NEW.task_id is not null then
    select o.id, o.plan_id, p.external_id
      into v_order_id, v_plan_id, v_product_external_id
      from production_tasks t
      join production_orders o on o.id = t.order_id
      join products p on p.id = o.product_id
     where t.id = NEW.task_id;
  end if;

  if NEW.type = 'RESULT_RECORDED' then
    v_result_id := NEW.payload->>'resultId';
    if v_result_id is not null then
      select r.good_quantity, r.scrap_quantity
        into v_quantity_good, v_quantity_scrap
        from production_results r
       where r.id = v_result_id;
    end if;
  end if;

  v_equipment_external_id := coalesce(NEW.payload->>'equipmentExternalId', NEW.payload->>'equipmentId');
  if v_equipment_external_id is not null then
    select coalesce(e.code, e.id)
      into v_equipment_external_id
      from equipment e
     where e.id = v_equipment_external_id;
  end if;

  if v_plan_id is null then
    return NEW;
  end if;

  select version into v_plan_version
    from operational_plans
   where id = v_plan_id;

  v_payload := jsonb_build_object(
    'contractVersion', '1.0',
    'eventId', NEW.id,
    'eventType', v_event_type,
    'occurredAt', NEW.occurred_at,
    'mesPlanId', v_plan_id,
    'mesPlanVersion', coalesce(v_plan_version, 1),
    'productionOrderExternalId', case when v_order_id is null then null else coalesce((select external_id from production_orders where id = v_order_id), v_order_id) end,
    'taskId', NEW.task_id,
    'productExternalId', v_product_external_id,
    'quantityGood', v_quantity_good,
    'quantityScrap', v_quantity_scrap,
    'equipmentExternalId', v_equipment_external_id,
    'idempotencyKey', NEW.id,
    'actorId', NEW.actor_id
  );

  insert into integration_outbox (idempotency_key, event_payload)
  values (NEW.id, v_payload)
  on conflict (idempotency_key) do nothing;

  return NEW;
end;
$$;

drop trigger if exists production_event_workforce_outbox on production_events;
create trigger production_event_workforce_outbox
after insert on production_events
for each row execute function mes_enqueue_workforce_event_from_production_event();

-- 2. Make production result registration the authoritative transaction boundary:
--    append result -> update task -> journal event(s) -> synchronize order fact.
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
  v_result production_results%rowtype;
  v_new_actual numeric;
  v_next_status text;
  v_employee_id text;
  v_event_id text;
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
    raise exception 'Факт выпуска допустим только для выполняемого задания';
  end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;
  if mes_current_role() = 'OPERATOR' and not exists (
    select 1 from task_assignments a
     where a.task_id = p_task_id
       and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  if v_task.actual_quantity + p_good_quantity > v_task.planned_quantity then
    raise exception 'Факт выпуска превышает плановое количество';
  end if;

  v_new_actual := v_task.actual_quantity + p_good_quantity;
  v_next_status := case
    when v_new_actual >= v_task.planned_quantity
      and (not v_task.quality_required or v_task.quality_status = 'APPROVED')
      then 'COMPLETED'
    when can_transition_status(v_task.status, 'PARTIALLY_COMPLETED')
      then 'PARTIALLY_COMPLETED'
    else v_task.status
  end;

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
         status = v_next_status,
         actual_end = case when v_next_status = 'COMPLETED' then coalesce(actual_end, p_recorded_at) else actual_end end,
         version = version + 1
   where id = p_task_id
   returning * into v_task;

  v_event_id := concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text));
  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    v_event_id,
    p_task_id,
    'RESULT_RECORDED',
    p_recorded_at,
    auth.uid()::text,
    jsonb_build_object(
      'source', 'PRODUCTION_RESULT',
      'resultId', v_result.id,
      'goodQuantity', p_good_quantity,
      'scrapQuantity', p_scrap_quantity,
      'employeeId', v_employee_id,
      'role', mes_current_role(),
      'status', v_task.status,
      'qualityRequired', v_task.quality_required,
      'qualityStatus', v_task.quality_status
    )
  );

  if v_task.status = 'COMPLETED' then
    insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
    values (
      concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
      p_task_id,
      'TASK_COMPLETED',
      p_recorded_at,
      auth.uid()::text,
      jsonb_build_object(
        'source', 'PRODUCTION_RESULT',
        'resultId', v_result.id,
        'actualQuantity', v_task.actual_quantity,
        'plannedQuantity', v_task.planned_quantity,
        'qualityRequired', v_task.quality_required,
        'qualityStatus', v_task.quality_status
      )
    );
  end if;

  -- Partial and complete facts must both be reflected upstream atomically.
  perform mes_sync_order_from_task(v_task.order_id);

  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;

-- 3. Tag quality events explicitly so the outbox trigger can distinguish them
--    from real production result events.
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
  v_after_task production_tasks%rowtype;
  v_auto_completed boolean := false;
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
  if v_task.status not in ('RUNNING','PAUSED','PARTIALLY_COMPLETED') then
    raise exception 'Решение ОТК допустимо только для выполняемого задания';
  end if;

  if p_good_quantity + p_scrap_quantity <> v_task.actual_quantity then
    raise exception 'Сумма результата ОТК должна совпадать с фактическим выпуском задания: %', v_task.actual_quantity;
  end if;
  if p_status = 'APPROVED' then
    if p_scrap_quantity <> 0 then raise exception 'При APPROVED количество брака должно быть 0'; end if;
  elsif coalesce(nullif(trim(p_defect_code), ''), '') = '' then
    raise exception 'Для отклонения ОТК требуется код дефекта';
  end if;

  insert into quality_inspections(
    id, task_id, inspected_at, inspector_id, status,
    good_quantity, scrap_quantity, defect_code, comment
  ) values (
    concat('QI-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    p_inspected_at,
    auth.uid()::text,
    p_status,
    p_good_quantity,
    p_scrap_quantity,
    nullif(trim(p_defect_code), ''),
    nullif(p_comment, '')
  ) returning * into v_inspection;

  update production_tasks
     set quality_status = p_status,
         status = case
           when p_status = 'APPROVED'
            and v_task.actual_quantity >= v_task.planned_quantity
             then 'COMPLETED'
           else status
         end,
         actual_end = case
           when p_status = 'APPROVED'
            and v_task.actual_quantity >= v_task.planned_quantity
             then coalesce(actual_end, p_inspected_at)
           else actual_end
         end,
         version = version + 1
   where id = p_task_id
   returning * into v_after_task;

  v_auto_completed := v_after_task.status = 'COMPLETED' and v_task.status <> 'COMPLETED';

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    'RESULT_RECORDED',
    p_inspected_at,
    auth.uid()::text,
    jsonb_build_object(
      'source', 'QUALITY_INSPECTION',
      'qualityInspectionId', v_inspection.id,
      'qualityStatus', p_status,
      'defectCode', v_inspection.defect_code,
      'goodQuantity', p_good_quantity,
      'scrapQuantity', p_scrap_quantity,
      'taskStatusBefore', v_task.status,
      'taskStatusAfter', v_after_task.status,
      'autoCompleted', v_auto_completed
    )
  );

  if v_auto_completed then
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
        'actualQuantity', v_after_task.actual_quantity,
        'plannedQuantity', v_after_task.planned_quantity
      )
    );
  end if;

  perform mes_sync_order_from_task(v_after_task.order_id);
  return v_inspection;
end;
$$;

grant execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) to authenticated;

comment on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) is
'Atomically records MES production fact, emits upstream-relevant events and synchronizes order plan/fact.';

comment on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) is
'Atomically records full-quantity quality decision; quality-only journal events are not sent as production facts to Workforce.';
