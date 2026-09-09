-- MES optimistic-locking hardening for entities without numeric versions.
-- Order and maintenance state transitions accept the observed current state and
-- reject stale writers. Route master-data mutations serialize per product.

create or replace function mes_change_order_status(
  p_order_id text,
  p_next_status text,
  p_expected_status text default null,
  p_expected_completed_quantity numeric default null
)
returns production_orders
language plpgsql
security definer
set search_path = public, pg_temp
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

  select * into v_order
    from production_orders
   where id = p_order_id
   for update;
  if not found then
    raise exception 'Производственный заказ не найден: %', p_order_id;
  end if;
  v_before := v_order;

  if p_expected_status is not null and v_order.status <> p_expected_status then
    raise exception 'Статус заказа устарел: ожидается %, фактически %', p_expected_status, v_order.status;
  end if;
  if p_expected_completed_quantity is not null and v_order.completed_quantity <> p_expected_completed_quantity then
    raise exception 'Факт заказа устарел: ожидается %, фактически %', p_expected_completed_quantity, v_order.completed_quantity;
  end if;

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
  elsif p_next_status = 'PARTIALLY_COMPLETED' then
    if v_order.status not in ('IN_EXECUTION','RELEASED') then raise exception 'PARTIALLY_COMPLETED допустим только для выполняемого заказа'; end if;
    if v_order.completed_quantity <= 0 or v_order.completed_quantity >= v_order.quantity then raise exception 'Некорректный факт для частично выполненного заказа'; end if;
  elsif p_next_status = 'COMPLETED' then
    perform mes_assert_order_route_completeness(v_order.id, 'COMPLETED');
  elsif p_next_status = 'CANCELLED' then
    if v_order.status = 'COMPLETED' then raise exception 'Завершенный заказ нельзя отменить'; end if;
  elsif p_next_status = 'BLOCKED' then
    if v_order.status in ('COMPLETED','CANCELLED') then raise exception 'Завершенный или отмененный заказ нельзя заблокировать'; end if;
  end if;

  update production_orders
     set status = p_next_status
   where id = p_order_id
   returning * into v_order;

  if v_before.status is distinct from v_order.status then
    insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
    values (
      auth.uid()::text,
      'MES_PRODUCTION_ORDER',
      v_order.id,
      'ORDER_STATUS_CHANGED',
      jsonb_build_object('status', v_before.status, 'completedQuantity', v_before.completed_quantity),
      jsonb_build_object('status', v_order.status, 'completedQuantity', v_order.completed_quantity, 'optimisticLock', true)
    );
  end if;

  return v_order;
end;
$$;

grant execute on function mes_change_order_status(text,text,text,numeric) to authenticated;
revoke execute on function mes_change_order_status(text,text) from authenticated;

create or replace function mes_change_maintenance_status(
  p_order_id text,
  p_next_status text,
  p_expected_status text default null
)
returns maintenance_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order maintenance_orders%rowtype;
  v_before maintenance_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE']) then
    raise exception 'Недостаточно прав для изменения статуса ТО';
  end if;

  select * into v_order from maintenance_orders where id = p_order_id for update;
  if not found then raise exception 'Заказ ТО не найден: %', p_order_id; end if;
  v_before := v_order;

  if p_expected_status is not null and v_order.status <> p_expected_status then
    raise exception 'Статус ТО устарел: ожидается %, фактически %', p_expected_status, v_order.status;
  end if;
  if p_next_status not in ('PLANNED','IN_PROGRESS','DONE','CANCELLED') then
    raise exception 'Недопустимый статус ТО: %', p_next_status;
  end if;
  if v_order.status = p_next_status then return v_order; end if;

  if v_order.status = 'DONE' then raise exception 'Завершенное ТО нельзя изменить'; end if;
  if v_order.status = 'CANCELLED' and p_next_status <> 'CANCELLED' then raise exception 'Отмененное ТО нельзя возобновить'; end if;
  if p_next_status = 'IN_PROGRESS' and v_order.status <> 'PLANNED' then raise exception 'Запустить можно только запланированное ТО'; end if;
  if p_next_status = 'DONE' and v_order.status <> 'IN_PROGRESS' then raise exception 'Завершить можно только выполняемое ТО'; end if;

  update maintenance_orders
     set status = p_next_status
   where id = p_order_id
   returning * into v_order;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'MES_MAINTENANCE_ORDER',
    v_order.id,
    'MAINTENANCE_STATUS_CHANGED',
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_order.status, 'optimisticLock', true)
  );

  return v_order;
end;
$$;

grant execute on function mes_change_maintenance_status(text,text,text) to authenticated;
revoke execute on function mes_change_maintenance_status(text,text) from authenticated;

-- Route master-data updates serialize by product so a concurrent planner cannot
-- observe half-applied route changes while creating or validating tasks.
create or replace function mes_save_route_operation(
  p_id text,
  p_product_id text,
  p_sequence integer,
  p_code text,
  p_name text,
  p_work_center text,
  p_required_qualification integer,
  p_required_equipment_ids jsonb,
  p_setup_minutes integer,
  p_run_minutes_per_unit numeric,
  p_active boolean
)
returns route_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result route_operations;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']) then
    raise exception 'Недостаточно прав для изменения технологического маршрута';
  end if;
  if coalesce(trim(p_id), '') = '' then raise exception 'Идентификатор операции обязателен'; end if;
  if coalesce(trim(p_product_id), '') = '' then raise exception 'Продукт операции обязателен'; end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'Код и наименование операции обязательны'; end if;
  if coalesce(trim(p_work_center), '') = '' then raise exception 'Производственный участок обязателен'; end if;

  perform pg_advisory_xact_lock(hashtextextended('mes:route-product:' || trim(p_product_id), 0));

  insert into route_operations (
    id, product_id, sequence, code, name, work_center,
    required_qualification, required_equipment_ids, setup_minutes,
    run_minutes_per_unit, active
  ) values (
    trim(p_id), trim(p_product_id), p_sequence, trim(p_code), trim(p_name), trim(p_work_center),
    p_required_qualification, coalesce(p_required_equipment_ids, '[]'::jsonb), p_setup_minutes,
    p_run_minutes_per_unit, coalesce(p_active, true)
  )
  on conflict (id) do update set
    product_id = excluded.product_id,
    sequence = excluded.sequence,
    code = excluded.code,
    name = excluded.name,
    work_center = excluded.work_center,
    required_qualification = excluded.required_qualification,
    required_equipment_ids = excluded.required_equipment_ids,
    setup_minutes = excluded.setup_minutes,
    run_minutes_per_unit = excluded.run_minutes_per_unit,
    active = excluded.active
  returning * into result;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text, 'MES_ROUTE_OPERATION', result.id, 'ROUTE_OPERATION_SAVED', null, to_jsonb(result)
  );

  return result;
end;
$$;

grant execute on function mes_save_route_operation(text,text,integer,text,text,text,integer,jsonb,integer,numeric,boolean) to authenticated;

create or replace function mes_delete_route_operation(p_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed route_operations;
  v_product_id text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']) then
    raise exception 'Недостаточно прав для удаления технологического маршрута';
  end if;

  select product_id into v_product_id from route_operations where id = p_id;
  if v_product_id is null then raise exception 'Операция маршрута не найдена'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mes:route-product:' || v_product_id, 0));

  if exists (select 1 from production_tasks where operation_id = p_id) then
    raise exception 'Нельзя удалить технологическую операцию %, пока существуют производственные задания; деактивируйте операцию', p_id;
  end if;

  delete from route_operations where id = p_id returning * into removed;
  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (auth.uid()::text, 'MES_ROUTE_OPERATION', removed.id, 'ROUTE_OPERATION_DELETED', to_jsonb(removed), null);
end;
$$;

grant execute on function mes_delete_route_operation(text) to authenticated;

comment on function mes_change_order_status(text,text,text,numeric) is
'Order status transition with database row lock plus optional optimistic precondition on status and fact.';
comment on function mes_change_maintenance_status(text,text,text) is
'Maintenance status transition with database row lock plus optional optimistic status precondition.';
comment on function mes_save_route_operation(text,text,integer,text,text,text,integer,jsonb,integer,numeric,boolean) is
'Route master-data mutation serialized by product advisory lock.';
