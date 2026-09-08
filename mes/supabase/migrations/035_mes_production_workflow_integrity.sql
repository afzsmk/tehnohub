-- MES production workflow integrity hardening.
-- Keeps the operational contour deterministic and server-authoritative across
-- execution, quality approval and order plan-fact synchronization.

-- 1. A task cannot be manually completed before its planned quantity is reached.
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
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Задание уже завершено или отменено';
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
  if not can_transition_status(v_task.status, v_next_status) then
    raise exception 'Недопустимый переход % -> % для действия %', v_task.status, v_next_status, p_action;
  end if;
  if p_action = 'START' and v_task.status <> 'READY' then
    raise exception 'Запуск разрешён только для подготовленного задания (READY)';
  end if;
  if p_action = 'COMPLETE' and v_task.actual_quantity < v_task.planned_quantity then
    raise exception 'Нельзя завершить задание: выполнено % из %', v_task.actual_quantity, v_task.planned_quantity;
  end if;
  if p_action = 'COMPLETE' and v_task.quality_required and v_task.quality_status <> 'APPROVED' then
    raise exception 'Нельзя завершить задание без одобрения ОТК';
  end if;

  update production_tasks
     set status = v_next_status,
         actual_start = case when p_action = 'START' then coalesce(actual_start, p_occurred_at) else actual_start end,
         actual_end = case when p_action = 'COMPLETE' then p_occurred_at else actual_end end,
         quality_status = case
           when p_action = 'START' and quality_required and quality_status = 'NOT_REQUIRED' then 'PENDING'
           else quality_status
         end,
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
    jsonb_build_object(
      'action', p_action,
      'status', v_next_status,
      'employeeId', v_employee_id,
      'role', mes_current_role(),
      'actualQuantity', v_task.actual_quantity,
      'plannedQuantity', v_task.planned_quantity,
      'qualityRequired', v_task.quality_required,
      'qualityStatus', v_task.quality_status
    )
  );

  return v_task;
end;
$$;

grant execute on function mes_execute_task_action(text,text,timestamptz) to authenticated;

-- 2. Quality approval for a full production task must cover the complete
--    produced quantity. Rejected inspections remain free to describe defects.
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

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;
  if not v_task.quality_required then
    raise exception 'Для задания ОТК не требуется';
  end if;
  if v_task.quality_status <> 'PENDING' then
    raise exception 'Задание не ожидает решения ОТК';
  end if;

  if p_status = 'APPROVED' then
    if p_scrap_quantity <> 0 then
      raise exception 'При APPROVED количество брака должно быть 0';
    end if;
    if p_good_quantity <> v_task.actual_quantity then
      raise exception 'При APPROVED количество годных изделий должно совпадать с фактом задания: %', v_task.actual_quantity;
    end if;
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
         version = version + 1
   where id = p_task_id;

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
      'role', mes_current_role()
    )
  );

  return v_inspection;
end;
$$;

grant execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) to authenticated;

-- 3. Make automatic order completion depend on both the full quantity and
--    completion/quality state of every task on the latest technological op.
create or replace function mes_sync_order_from_task(p_order_id text)
returns production_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order production_orders%rowtype;
  v_before production_orders%rowtype;
  v_latest_sequence integer;
  v_completed numeric;
  v_any_execution boolean;
  v_latest_task_count integer := 0;
  v_latest_incomplete_count integer := 0;
  v_new_status text;
begin
  select * into v_order
    from production_orders
   where id = p_order_id
   for update;
  if not found then
    raise exception 'Производственный заказ не найден: %', p_order_id;
  end if;
  v_before := v_order;

  select max(t.operation_sequence)
    into v_latest_sequence
    from production_tasks t
   where t.order_id = p_order_id
     and t.status <> 'CANCELLED';
  if v_latest_sequence is null then
    return v_order;
  end if;

  select count(*), count(*) filter (
      where t.status <> 'COMPLETED'
         or (t.quality_required and t.quality_status <> 'APPROVED')
    )
    into v_latest_task_count, v_latest_incomplete_count
    from production_tasks t
   where t.order_id = p_order_id
     and t.operation_sequence = v_latest_sequence
     and t.status <> 'CANCELLED';

  select coalesce(sum(t.actual_quantity), 0)
    into v_completed
    from production_tasks t
   where t.order_id = p_order_id
     and t.operation_sequence = v_latest_sequence
     and t.status <> 'CANCELLED';

  select exists (
    select 1 from production_tasks t
     where t.order_id = p_order_id
       and t.status in ('RUNNING','PAUSED','PARTIALLY_COMPLETED','COMPLETED')
  ) into v_any_execution;

  v_completed := least(v_order.quantity, greatest(0, v_completed));

  v_new_status := case
    when v_completed >= v_order.quantity
         and v_latest_task_count > 0
         and v_latest_incomplete_count = 0 then 'COMPLETED'
    when v_completed > 0 then 'PARTIALLY_COMPLETED'
    when v_any_execution and v_order.status not in ('CANCELLED','BLOCKED') then 'IN_EXECUTION'
    else v_order.status
  end;

  if v_order.status = 'CANCELLED' then
    return v_order;
  end if;
  if v_order.status = 'COMPLETED' and v_new_status <> 'COMPLETED' then
    raise exception 'Нельзя откатить завершённый заказ автоматически';
  end if;

  update production_orders
     set completed_quantity = v_completed,
         status = v_new_status
   where id = p_order_id
   returning * into v_order;

  if v_before.completed_quantity is distinct from v_order.completed_quantity
     or v_before.status is distinct from v_order.status then
    insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
    values (
      coalesce(auth.uid()::text, 'mes-system'),
      'MES_PRODUCTION_ORDER',
      v_order.id,
      'ORDER_FACT_AUTO_SYNCED',
      jsonb_build_object(
        'status', v_before.status,
        'completedQuantity', v_before.completed_quantity
      ),
      jsonb_build_object(
        'status', v_order.status,
        'completedQuantity', v_order.completed_quantity,
        'source', 'LATEST_TECHNOLOGICAL_OPERATION',
        'operationSequence', v_latest_sequence,
        'latestTaskCount', v_latest_task_count,
        'latestIncompleteTaskCount', v_latest_incomplete_count
      )
    );
  end if;

  return v_order;
end;
$$;

grant execute on function mes_sync_order_from_task(text) to authenticated;

-- 4. Strengthen manual order completion with the same latest-operation rule.
create or replace function mes_change_order_status(
  p_order_id text,
  p_next_status text
)
returns production_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order production_orders%rowtype;
  v_before production_orders%rowtype;
  v_route_count integer := 0;
  v_task_count integer := 0;
  v_bad_task_count integer := 0;
  v_latest_sequence integer;
  v_latest_task_count integer := 0;
  v_latest_bad_task_count integer := 0;
  v_next_completed numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для изменения статуса заказа';
  end if;

  select * into v_order from production_orders where id = p_order_id for update;
  if not found then raise exception 'Производственный заказ не найден: %', p_order_id; end if;
  v_before := v_order;

  if p_next_status not in ('IMPORTED','PLANNED','RELEASED','IN_EXECUTION','PARTIALLY_COMPLETED','COMPLETED','CANCELLED','BLOCKED') then
    raise exception 'Недопустимый статус заказа: %', p_next_status;
  end if;
  if v_order.status = p_next_status then return v_order; end if;
  if v_order.status = 'COMPLETED' then raise exception 'Завершенный заказ нельзя изменить'; end if;

  if p_next_status = 'PLANNED' then
    if v_order.status <> 'IMPORTED' then raise exception 'В PLANNED можно перевести только импортированный заказ'; end if;
    select count(*) into v_route_count from route_operations where product_id = v_order.product_id and active;
    if v_route_count = 0 then raise exception 'Нельзя планировать заказ без активного технологического маршрута'; end if;
  elsif p_next_status = 'RELEASED' then
    if v_order.status not in ('PLANNED','BLOCKED') then raise exception 'В RELEASED можно перевести только подготовленный или разблокированный заказ'; end if;
    select count(*) into v_route_count from route_operations where product_id = v_order.product_id and active;
    if v_route_count = 0 then raise exception 'Нельзя выпустить заказ без активного технологического маршрута'; end if;
    select count(*) into v_task_count from production_tasks where order_id = v_order.id;
    if v_task_count = 0 then raise exception 'Нельзя выпустить заказ без производственных заданий'; end if;
    select count(*) into v_bad_task_count from production_tasks where order_id = v_order.id and status in ('DRAFT','BLOCKED','CANCELLED');
    if v_bad_task_count > 0 then raise exception 'Заказ содержит неподготовленные задания: %', v_bad_task_count; end if;
  elsif p_next_status = 'IN_EXECUTION' then
    if v_order.status not in ('RELEASED','PARTIALLY_COMPLETED') then raise exception 'В IN_EXECUTION можно перевести только выпущенный или частично выполненный заказ'; end if;
    if not exists (select 1 from production_tasks where order_id = v_order.id and status in ('RUNNING','PAUSED','PARTIALLY_COMPLETED','COMPLETED')) then
      raise exception 'Для начала исполнения заказа нет активных производственных заданий';
    end if;
  elsif p_next_status in ('PARTIALLY_COMPLETED','COMPLETED') then
    if p_next_status = 'PARTIALLY_COMPLETED' and v_order.status not in ('IN_EXECUTION','RELEASED') then
      raise exception 'Некорректный переход заказа в PARTIALLY_COMPLETED';
    end if;
    if p_next_status = 'COMPLETED' and v_order.status not in ('IN_EXECUTION','PARTIALLY_COMPLETED') then
      raise exception 'Завершить можно только выполняемый или частично выполненный заказ';
    end if;

    select max(t.operation_sequence) into v_latest_sequence
      from production_tasks t where t.order_id = v_order.id and t.status <> 'CANCELLED';
    if v_latest_sequence is null then raise exception 'У заказа нет действующих производственных заданий'; end if;

    select count(*), count(*) filter (
      where t.status <> 'COMPLETED' or (t.quality_required and t.quality_status <> 'APPROVED')
    ) into v_latest_task_count, v_latest_bad_task_count
      from production_tasks t
     where t.order_id = v_order.id and t.operation_sequence = v_latest_sequence and t.status <> 'CANCELLED';

    select coalesce(sum(t.actual_quantity), 0) into v_next_completed
      from production_tasks t
     where t.order_id = v_order.id and t.operation_sequence = v_latest_sequence and t.status <> 'CANCELLED';

    if p_next_status = 'PARTIALLY_COMPLETED' then
      if v_next_completed <= 0 or v_next_completed >= v_order.quantity then
        raise exception 'Заказ не имеет частичного фактического выполнения по последней операции';
      end if;
    elsif v_next_completed < v_order.quantity then
      raise exception 'Нельзя завершить заказ: по последней операции выполнено %, требуется %', v_next_completed, v_order.quantity;
    elsif v_latest_task_count = 0 or v_latest_bad_task_count > 0 then
      raise exception 'Нельзя завершить заказ: последняя технологическая операция содержит незавершенные или неутвержденные задания';
    end if;
  elsif p_next_status = 'CANCELLED' then
    raise exception 'Отменить можно только незавершенный заказ';
  elsif p_next_status = 'BLOCKED' then
    if v_order.status not in ('IMPORTED','PLANNED','RELEASED','IN_EXECUTION','PARTIALLY_COMPLETED') then
      raise exception 'Нельзя заблокировать заказ из статуса %', v_order.status;
    end if;
  elsif p_next_status = 'IMPORTED' then
    raise exception 'Возврат в IMPORTED запрещен';
  end if;

  update production_orders
     set status = p_next_status,
         completed_quantity = case
           when p_next_status in ('PARTIALLY_COMPLETED','COMPLETED')
             then greatest(completed_quantity, least(v_order.quantity, v_next_completed))
           else completed_quantity
         end
   where id = v_order.id
   returning * into v_order;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'MES_PRODUCTION_ORDER',
    v_order.id,
    'ORDER_STATUS_CHANGED',
    jsonb_build_object('status', v_before.status, 'completedQuantity', v_before.completed_quantity),
    jsonb_build_object('status', v_order.status, 'completedQuantity', v_order.completed_quantity)
  );

  return v_order;
end;
$$;

grant execute on function mes_change_order_status(text,text) to authenticated;

comment on function mes_execute_task_action(text,text,timestamptz) is
'Controlled MES task execution; completion requires full planned quantity and Quality approval when required.';
comment on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) is
'Controlled MES Quality decision; approval must cover the complete task fact quantity.';
comment on function mes_sync_order_from_task(text) is
'Authoritative MES order plan-fact synchronization from the latest technological operation with completion/quality integrity.';
comment on function mes_change_order_status(text,text) is
'Controlled MES production-order lifecycle; completion requires latest-operation task completion and Quality approval where required.';
