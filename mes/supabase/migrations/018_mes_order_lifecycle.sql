-- MES order lifecycle is enforced server-side; browser users cannot bypass
-- route/task readiness checks by writing production_orders directly.

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
  v_route_count integer := 0;
  v_task_count integer := 0;
  v_bad_task_count integer := 0;
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

  if p_next_status not in ('IMPORTED','PLANNED','RELEASED','IN_EXECUTION','PARTIALLY_COMPLETED','COMPLETED','CANCELLED','BLOCKED') then
    raise exception 'Недопустимый статус заказа: %', p_next_status;
  end if;

  if v_order.status = p_next_status then
    return v_order;
  end if;

  if v_order.status = 'COMPLETED' then
    raise exception 'Завершенный заказ нельзя изменить';
  end if;

  if p_next_status = 'PLANNED' then
    if v_order.status <> 'IMPORTED' then
      raise exception 'В PLANNED можно перевести только импортированный заказ';
    end if;
    select count(*) into v_route_count
      from route_operations
     where product_id = v_order.product_id and active;
    if v_route_count = 0 then
      raise exception 'Нельзя планировать заказ без активного технологического маршрута';
    end if;
  elsif p_next_status = 'RELEASED' then
    if v_order.status not in ('PLANNED','BLOCKED') then
      raise exception 'В RELEASED можно перевести только подготовленный или разблокированный заказ';
    end if;
    select count(*) into v_route_count
      from route_operations
     where product_id = v_order.product_id and active;
    if v_route_count = 0 then
      raise exception 'Нельзя выпустить заказ без активного технологического маршрута';
    end if;
    select count(*) into v_task_count
      from production_tasks
     where order_id = v_order.id;
    if v_task_count = 0 then
      raise exception 'Нельзя выпустить заказ без производственных заданий';
    end if;
    select count(*) into v_bad_task_count
      from production_tasks
     where order_id = v_order.id
       and status in ('DRAFT','BLOCKED','CANCELLED');
    if v_bad_task_count > 0 then
      raise exception 'Заказ содержит неподготовленные задания: %', v_bad_task_count;
    end if;
  elsif p_next_status = 'IN_EXECUTION' then
    if v_order.status not in ('RELEASED','PARTIALLY_COMPLETED') then
      raise exception 'В IN_EXECUTION можно перевести только выпущенный или частично выполненный заказ';
    end if;
    if not exists (
      select 1 from production_tasks
       where order_id = v_order.id
         and status in ('RUNNING','PAUSED','PARTIALLY_COMPLETED','COMPLETED')
    ) then
      raise exception 'Для начала исполнения заказа нет активных производственных заданий';
    end if;
  elsif p_next_status = 'PARTIALLY_COMPLETED' then
    if v_order.status not in ('IN_EXECUTION','RELEASED') then
      raise exception 'Некорректный переход заказа в PARTIALLY_COMPLETED';
    end if;
    select coalesce(sum(actual_quantity), 0) into v_next_completed
      from production_tasks
     where order_id = v_order.id;
    if v_next_completed <= 0 or v_next_completed >= v_order.quantity then
      raise exception 'Заказ не имеет частичного фактического выполнения';
    end if;
  elsif p_next_status = 'COMPLETED' then
    if v_order.status not in ('IN_EXECUTION','PARTIALLY_COMPLETED') then
      raise exception 'Завершить можно только выполняемый или частично выполненный заказ';
    end if;
    select coalesce(sum(actual_quantity), 0) into v_next_completed
      from production_tasks
     where order_id = v_order.id;
    if v_next_completed < v_order.quantity then
      raise exception 'Нельзя завершить заказ: выполнено %, требуется %', v_next_completed, v_order.quantity;
    end if;
  elsif p_next_status = 'CANCELLED' then
    if v_order.status = 'COMPLETED' then
      raise exception 'Завершенный заказ нельзя отменить';
    end if;
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
           when p_next_status in ('PARTIALLY_COMPLETED','COMPLETED') then greatest(completed_quantity, v_next_completed)
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
    jsonb_build_object('status', case when p_next_status is null then null else null end),
    jsonb_build_object('status', v_order.status, 'completedQuantity', v_order.completed_quantity)
  );

  return v_order;
end;
$$;

grant execute on function mes_change_order_status(text,text) to authenticated;

comment on function mes_change_order_status(text,text) is
'Controlled MES production-order lifecycle transition with route/task readiness validation and audit logging.';
