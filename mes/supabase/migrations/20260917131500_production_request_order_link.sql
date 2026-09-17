alter table production_orders
  add column if not exists source_request_item_id text references production_request_items(id);

create index if not exists idx_production_orders_source_request_item
  on production_orders(source_request_item_id);

create or replace function mes_create_production_order_from_request_item(
  p_request_item_id text,
  p_order_id text,
  p_order_number text,
  p_plan_id text,
  p_due_at timestamptz,
  p_priority text default 'NORMAL'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item production_request_items%rowtype;
  v_request production_requests%rowtype;
  v_existing production_orders%rowtype;
  v_product products%rowtype;
  v_plan operational_plans%rowtype;
  v_active_route_count integer;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для создания производственного заказа';
  end if;
  if nullif(trim(p_request_item_id),'') is null
     or nullif(trim(p_order_id),'') is null
     or nullif(trim(p_order_number),'') is null
     or nullif(trim(p_plan_id),'') is null
     or p_due_at is null then
    raise exception 'Позиция заявки, заказ, план и срок обязательны';
  end if;
  if coalesce(trim(p_priority),'') not in ('LOW','NORMAL','HIGH','URGENT') then
    raise exception 'Недопустимый приоритет заказа: %', p_priority;
  end if;

  select * into v_item
    from production_request_items
   where id = trim(p_request_item_id)
   for update;
  if not found then
    raise exception 'Позиция заявки не найдена: %', p_request_item_id;
  end if;

  select * into v_request
    from production_requests
   where id = v_item.request_id
   for update;
  if not found then
    raise exception 'Заявка позиции не найдена: %', v_item.request_id;
  end if;
  if v_request.status = 'CANCELLED' then
    raise exception 'Нельзя создать заказ из отменённой заявки';
  end if;

  select * into v_plan
    from operational_plans
   where id = trim(p_plan_id)
   for update;
  if not found then
    raise exception 'Операционный план не найден: %', p_plan_id;
  end if;
  if v_plan.status = 'ARCHIVED' then
    raise exception 'Нельзя создать заказ в архивном операционном плане';
  end if;

  select * into v_product
    from products
   where id = v_item.product_id;
  if not found then
    raise exception 'Номенклатура позиции заявки не найдена: %', v_item.product_id;
  end if;

  select count(*) into v_active_route_count
    from route_operations
   where product_id = v_item.product_id
     and active;
  if v_active_route_count = 0 then
    raise exception 'Для номенклатуры % нет активного технологического маршрута', v_product.code;
  end if;

  select * into v_existing
    from production_orders
   where source_request_item_id = v_item.id
     and status <> 'CANCELLED'
   order by number
   limit 1;
  if found then
    return jsonb_build_object(
      'created', false,
      'orderId', v_existing.id,
      'orderNumber', v_existing.number,
      'status', v_existing.status,
      'sourceRequestItemId', v_item.id,
      'requestId', v_request.id,
      'requestStatus', v_request.status
    );
  end if;

  if exists (
    select 1 from production_orders
     where number = trim(p_order_number)
       and id <> trim(p_order_id)
  ) then
    raise exception 'Номер производственного заказа уже используется: %', p_order_number;
  end if;

  if exists (select 1 from production_orders where id = trim(p_order_id)) then
    raise exception 'Идентификатор производственного заказа уже используется: %', p_order_id;
  end if;

  insert into production_orders(
    id,
    number,
    plan_id,
    product_id,
    quantity,
    completed_quantity,
    due_at,
    priority,
    status,
    source_request_item_id
  ) values (
    trim(p_order_id),
    trim(p_order_number),
    trim(p_plan_id),
    v_item.product_id,
    v_item.quantity,
    0,
    p_due_at,
    trim(p_priority),
    'IMPORTED',
    v_item.id
  );

  update production_requests
     set status = case
       when not exists (
         select 1
           from production_request_items i
          where i.request_id = v_request.id
            and not exists (
              select 1
                from production_orders o
               where o.source_request_item_id = i.id
                 and o.status <> 'CANCELLED'
            )
       ) then 'PLANNED'
       else 'NEW'
     end,
         updated_at = now()
   where id = v_request.id;

  insert into audit_log(actor_id, entity_type, entity_id, action, after_state)
  values (
    auth.uid()::text,
    'PRODUCTION_ORDER',
    trim(p_order_id),
    'CREATED_FROM_PRODUCTION_REQUEST',
    jsonb_build_object(
      'requestId', v_request.id,
      'requestItemId', v_item.id,
      'requestNumber', v_request.request_number,
      'requestLine', v_item.line_no,
      'productId', v_item.product_id,
      'quantity', v_item.quantity,
      'planId', trim(p_plan_id),
      'dueAt', p_due_at,
      'priority', trim(p_priority)
    )
  );

  select status into v_request.status from production_requests where id = v_request.id;

  return jsonb_build_object(
    'created', true,
    'orderId', trim(p_order_id),
    'orderNumber', trim(p_order_number),
    'status', 'IMPORTED',
    'sourceRequestItemId', v_item.id,
    'requestId', v_request.id,
    'requestStatus', v_request.status
  );
end;
$$;

grant execute on function mes_create_production_order_from_request_item(text,text,text,text,timestamptz,text) to authenticated;
