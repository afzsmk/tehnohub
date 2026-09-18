-- MES production request / order control and feasibility
create or replace function public.mes_check_production_request_feasibility(
  p_request_id text,
  p_plan_id text,
  p_due_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request production_requests%rowtype;
  v_plan operational_plans%rowtype;
  v_due_at timestamptz;
  v_item production_request_items%rowtype;
  v_operation route_operations%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_required_hours numeric;
  v_available_hours numeric;
  v_route_count integer;
  v_item_results jsonb := '[]'::jsonb;
  v_all_feasible boolean := true;
  v_blocking_reason text;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для проверки выполнимости заявки';
  end if;

  select * into v_request from production_requests where id=trim(p_request_id);
  if not found then raise exception 'Заявка не найдена: %',p_request_id; end if;
  if v_request.status='CANCELLED' then raise exception 'Нельзя проверить отменённую заявку'; end if;

  select * into v_plan from operational_plans where id=trim(p_plan_id);
  if not found then raise exception 'Операционный план не найден: %',p_plan_id; end if;
  if v_plan.status='ARCHIVED' then raise exception 'Нельзя проверить заявку в архивном плане'; end if;

  v_due_at := coalesce(p_due_at,(v_request.desired_date + time '23:59:59')::timestamptz);

  if v_due_at <= v_plan.horizon_start then
    raise exception 'Срок заказа должен быть после начала горизонта плана';
  end if;
  if v_due_at > v_plan.horizon_end then
    raise exception 'Срок заказа выходит за горизонт операционного плана';
  end if;

  v_start := greatest(now(),v_plan.horizon_start);

  for v_item in
    select * from production_request_items
    where request_id=v_request.id
    order by line_no
  loop
    v_required_hours := 0;
    v_route_count := 0;
    v_blocking_reason := null;

    for v_operation in
      select * from route_operations
      where product_id=v_item.product_id and active
      order by sequence
    loop
      v_route_count := v_route_count + 1;
      if v_operation.labor_norm_hours_per_unit is null
         or v_operation.setup_norm_hours is null
         or coalesce(v_operation.workers_required,0) <= 0 then
        v_blocking_reason := format('Операция %s имеет неполную трудовую норму/численность',v_operation.code);
        exit;
      end if;
      v_required_hours := v_required_hours
        + coalesce(v_operation.setup_norm_hours,0)
        + (
          coalesce(v_operation.labor_norm_hours_per_unit,0)
          * greatest(v_item.quantity,0)
        ) / greatest(v_operation.workers_required,1);
    end loop;

    if v_route_count=0 then
      v_blocking_reason := 'Для номенклатуры нет активного технологического маршрута';
    end if;

    if v_blocking_reason is null then
      v_end := v_start + make_interval(secs => ceil(v_required_hours*3600)::integer);
      v_available_hours := greatest(extract(epoch from (v_due_at-v_start))/3600,0);
      if v_end > v_due_at or v_end > v_plan.horizon_end then
        v_blocking_reason := format(
          'Маршрут не помещается в срок: требуется %.2f ч, доступно %.2f ч',
          v_required_hours,v_available_hours
        );
      end if;
    else
      v_end := null;
      v_available_hours := greatest(extract(epoch from (v_due_at-v_start))/3600,0);
    end if;

    if v_blocking_reason is not null then v_all_feasible := false; end if;

    v_item_results := v_item_results || jsonb_build_array(jsonb_build_object(
      'requestItemId',v_item.id,
      'lineNo',v_item.line_no,
      'productId',v_item.product_id,
      'quantity',v_item.quantity,
      'requiredHours',round(v_required_hours,2),
      'availableHours',round(v_available_hours,2),
      'projectedEnd',v_end,
      'feasible',v_blocking_reason is null,
      'reason',v_blocking_reason,
      'resourceCheck','not_run'
    ));
  end loop;

  return jsonb_build_object(
    'requestId',v_request.id,
    'planId',v_plan.id,
    'dueAt',v_due_at,
    'feasible',v_all_feasible,
    'items',v_item_results,
    'checkScope','route_time_and_plan_horizon',
    'note','Предварительная проверка повторяет текущую серверную проверку длительности маршрута. Конфликты конкретного ресурса проверяются при назначении.'
  );
end;
$function$;

create or replace function public.mes_update_production_request(
  p_id text,
  p_request_number text,
  p_object_name text,
  p_desired_date date,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request production_requests%rowtype;
  item jsonb;
  v_line integer := 0;
  v_product_id text;
  v_quantity numeric;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для изменения заявки';
  end if;
  select * into v_request from production_requests where id=trim(p_id) for update;
  if not found then raise exception 'Заявка не найдена: %',p_id; end if;
  if v_request.status='CANCELLED' then raise exception 'Отменённую заявку нельзя редактировать'; end if;
  if exists(select 1 from production_orders o where o.source_request_item_id in (
    select id from production_request_items where request_id=v_request.id
  ) and o.status<>'CANCELLED') then
    raise exception 'Заявка уже передана в производство — редактирование запрещено; изменяйте производственные заказы';
  end if;
  if nullif(trim(p_request_number),'') is null or nullif(trim(p_object_name),'') is null or p_desired_date is null then
    raise exception 'Номер заявки, объект и желаемая дата обязательны';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Заявка должна содержать хотя бы одну позицию';
  end if;

  update production_requests
     set request_number=trim(p_request_number),
         object_name=trim(p_object_name),
         desired_date=p_desired_date,
         status='NEW',
         updated_at=now()
   where id=v_request.id;

  delete from production_request_items where request_id=v_request.id;
  for item in select value from jsonb_array_elements(p_items) loop
    v_line:=v_line+1;
    v_product_id:=nullif(trim(item->>'product_id'),'');
    v_quantity:=(item->>'quantity')::numeric;
    if v_product_id is null or v_quantity is null or v_quantity<=0 then
      raise exception 'Некорректная позиция заявки №%',v_line;
    end if;
    if not exists(select 1 from products where id=v_product_id) then
      raise exception 'Номенклатура не найдена: %',v_product_id;
    end if;
    insert into production_request_items(id,request_id,line_no,product_id,quantity)
    values(gen_random_uuid()::text,v_request.id,v_line,v_product_id,v_quantity);
  end loop;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(auth.uid()::text,'PRODUCTION_REQUEST',v_request.id,'UPDATE',
    jsonb_build_object('request_number',p_request_number,'object_name',p_object_name,'desired_date',p_desired_date,'items',p_items));

  return jsonb_build_object('id',v_request.id,'status','NEW','items_count',v_line);
end;
$function$;

create or replace function public.mes_cancel_production_request(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request production_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для отмены заявки';
  end if;
  select * into v_request from production_requests where id=trim(p_id) for update;
  if not found then raise exception 'Заявка не найдена: %',p_id; end if;
  if v_request.status='CANCELLED' then return jsonb_build_object('id',v_request.id,'status','CANCELLED'); end if;
  if exists(select 1 from production_orders o join production_request_items i on i.id=o.source_request_item_id
            where i.request_id=v_request.id and o.status<>'CANCELLED') then
    raise exception 'Нельзя отменить заявку с действующими производственными заказами. Сначала отмените/завершите связанные заказы.';
  end if;
  update production_requests set status='CANCELLED',updated_at=now() where id=v_request.id;
  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values(auth.uid()::text,'PRODUCTION_REQUEST',v_request.id,'CANCEL',
    jsonb_build_object('status',v_request.status),jsonb_build_object('status','CANCELLED'));
  return jsonb_build_object('id',v_request.id,'status','CANCELLED');
end;
$function$;

create or replace function public.mes_revise_production_order(
  p_order_id text,
  p_plan_id text,
  p_due_at timestamptz,
  p_priority text
) returns production_orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order production_orders%rowtype;
  v_before jsonb;
  v_plan operational_plans%rowtype;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для корректировки заказа';
  end if;
  select * into v_order from production_orders where id=trim(p_order_id) for update;
  if not found then raise exception 'Производственный заказ не найден: %',p_order_id; end if;
  if v_order.status not in ('IMPORTED','BLOCKED') then
    raise exception 'Корректировать можно только IMPORTED или BLOCKED заказ';
  end if;
  if exists(select 1 from production_tasks where order_id=v_order.id and status<>'CANCELLED') then
    raise exception 'У заказа уже есть задания — сначала отмените/перестройте их';
  end if;
  select * into v_plan from operational_plans where id=trim(p_plan_id);
  if not found then raise exception 'Операционный план не найден: %',p_plan_id; end if;
  if v_plan.status='ARCHIVED' then raise exception 'Нельзя использовать архивный план'; end if;
  if p_due_at is null or p_due_at<=v_plan.horizon_start or p_due_at>v_plan.horizon_end then
    raise exception 'Срок заказа должен находиться внутри горизонта выбранного плана';
  end if;
  if trim(p_priority) not in ('LOW','NORMAL','HIGH','URGENT') then raise exception 'Недопустимый приоритет заказа: %',p_priority; end if;

  v_before:=jsonb_build_object('planId',v_order.plan_id,'dueAt',v_order.due_at,'priority',v_order.priority,'status',v_order.status);
  update production_orders
     set plan_id=trim(p_plan_id),due_at=p_due_at,priority=trim(p_priority),status='IMPORTED'
   where id=v_order.id
   returning * into v_order;

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values(auth.uid()::text,'MES_PRODUCTION_ORDER',v_order.id,'ORDER_REVISED',v_before,
    jsonb_build_object('planId',v_order.plan_id,'dueAt',v_order.due_at,'priority',v_order.priority,'status',v_order.status));
  return v_order;
end;
$function$;

create or replace function public.mes_split_production_order(
  p_order_id text,
  p_parts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order production_orders%rowtype;
  v_part jsonb;
  v_idx integer := 0;
  v_quantity numeric;
  v_due_at timestamptz;
  v_plan_id text;
  v_priority text;
  v_number text;
  v_total numeric := 0;
  v_rows jsonb := '[]'::jsonb;
  v_plan operational_plans%rowtype;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для разбиения заказа';
  end if;
  select * into v_order from production_orders where id=trim(p_order_id) for update;
  if not found then raise exception 'Производственный заказ не найден: %',p_order_id; end if;
  if v_order.status not in ('IMPORTED','BLOCKED') then raise exception 'Разбивать можно только IMPORTED или BLOCKED заказ'; end if;
  if v_order.completed_quantity<>0 then raise exception 'Нельзя разбить заказ с фактически выполненным количеством'; end if;
  if exists(select 1 from production_tasks where order_id=v_order.id and status<>'CANCELLED') then
    raise exception 'Нельзя разбить заказ, в котором уже есть активные задания';
  end if;
  if p_parts is null or jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)<2 then
    raise exception 'Для разбиения нужно указать минимум две части';
  end if;
  if jsonb_array_length(p_parts)>10 then raise exception 'Максимум 10 частей'; end if;

  for v_part in select value from jsonb_array_elements(p_parts) loop
    v_idx:=v_idx+1;
    v_quantity:=(v_part->>'quantity')::numeric;
    v_due_at:=(v_part->>'dueAt')::timestamptz;
    v_plan_id:=nullif(trim(v_part->>'planId'),'');
    v_priority:=coalesce(nullif(trim(v_part->>'priority'),''),v_order.priority);
    v_number:=coalesce(nullif(trim(v_part->>'orderNumber'),''),v_order.number||'/P'||v_idx);
    if v_quantity is null or v_quantity<=0 or v_due_at is null or v_plan_id is null then
      raise exception 'Каждая часть должна иметь quantity, dueAt и planId';
    end if;
    if v_priority not in ('LOW','NORMAL','HIGH','URGENT') then raise exception 'Недопустимый приоритет части: %',v_priority; end if;
    select * into v_plan from operational_plans where id=v_plan_id;
    if not found then raise exception 'Операционный план части не найден: %',v_plan_id; end if;
    if v_plan.status='ARCHIVED' or v_due_at<=v_plan.horizon_start or v_due_at>v_plan.horizon_end then
      raise exception 'Срок части % находится вне горизонта плана %',v_idx,v_plan_id;
    end if;
    if exists(select 1 from production_orders where number=v_number) then raise exception 'Номер заказа уже используется: %',v_number; end if;
    v_total:=v_total+v_quantity;
  end loop;

  if abs(v_total-v_order.quantity)>0.000001 then
    raise exception 'Сумма частей %.3f не равна количеству исходного заказа %.3f',v_total,v_order.quantity;
  end if;

  update production_orders set status='CANCELLED' where id=v_order.id;

  v_idx:=0;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    v_idx:=v_idx+1;
    v_quantity:=(v_part->>'quantity')::numeric;
    v_due_at:=(v_part->>'dueAt')::timestamptz;
    v_plan_id:=trim(v_part->>'planId');
    v_priority:=coalesce(nullif(trim(v_part->>'priority'),''),v_order.priority);
    v_number:=coalesce(nullif(trim(v_part->>'orderNumber'),''),v_order.number||'/P'||v_idx);
    insert into production_orders(id,number,plan_id,product_id,quantity,completed_quantity,due_at,priority,status,source_request_item_id)
    values(
      'ORD-'||gen_random_uuid()::text,v_number,v_plan_id,v_order.product_id,v_quantity,0,v_due_at,v_priority,'IMPORTED',v_order.source_request_item_id
    )
    returning jsonb_build_object('id',id,'number',number,'quantity',quantity,'planId',plan_id,'dueAt',due_at,'priority',priority,'status',status) into v_part;
    v_rows:=v_rows||jsonb_build_array(v_part);
  end loop;

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values(auth.uid()::text,'MES_PRODUCTION_ORDER',v_order.id,'ORDER_SPLIT',
    jsonb_build_object('quantity',v_order.quantity,'number',v_order.number),
    jsonb_build_object('parts',v_rows));

  return jsonb_build_object('sourceOrderId',v_order.id,'sourceOrderNumber',v_order.number,'parts',v_rows);
end;
$function$;

revoke execute on function public.mes_check_production_request_feasibility(text,text,timestamptz) from public,anon;
grant execute on function public.mes_check_production_request_feasibility(text,text,timestamptz) to authenticated;
revoke execute on function public.mes_update_production_request(text,text,text,date,jsonb) from public,anon;
grant execute on function public.mes_update_production_request(text,text,text,date,jsonb) to authenticated;
revoke execute on function public.mes_cancel_production_request(text) from public,anon;
grant execute on function public.mes_cancel_production_request(text) to authenticated;
revoke execute on function public.mes_revise_production_order(text,text,timestamptz,text) from public,anon;
grant execute on function public.mes_revise_production_order(text,text,timestamptz,text) to authenticated;
revoke execute on function public.mes_split_production_order(text,jsonb) from public,anon;
grant execute on function public.mes_split_production_order(text,jsonb) to authenticated;
revoke execute on function public.mes_check_operational_integrity() from public,anon;
grant execute on function public.mes_check_operational_integrity() to authenticated;
grant select on table public.integration_outbox to authenticated;
