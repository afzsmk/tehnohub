-- Operational plan lifecycle and request-to-production bulk workflow.

create or replace function public.mes_create_operational_plan(
  p_id text,
  p_horizon_start timestamptz,
  p_horizon_end timestamptz
) returns operational_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan operational_plans%rowtype;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для создания операционного плана';
  end if;
  if nullif(trim(p_id),'') is null then raise exception 'Идентификатор операционного плана обязателен'; end if;
  if p_horizon_start is null or p_horizon_end is null or p_horizon_end <= p_horizon_start then
    raise exception 'Горизонт плана задан некорректно';
  end if;
  if exists (select 1 from operational_plans where id = trim(p_id)) then
    raise exception 'Операционный план уже существует: %', p_id;
  end if;

  insert into operational_plans(id,version,horizon_start,horizon_end,status,source_plan_id,source_plan_version)
  values(trim(p_id),1,p_horizon_start,p_horizon_end,'DRAFT',null,null)
  returning * into v_plan;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(auth.uid()::text,'OPERATIONAL_PLAN',v_plan.id,'PLAN_CREATED',
    jsonb_build_object('version',v_plan.version,'horizonStart',v_plan.horizon_start,'horizonEnd',v_plan.horizon_end,'status',v_plan.status));
  return v_plan;
end;
$$;

revoke all on function public.mes_create_operational_plan(text,timestamptz,timestamptz) from public, anon;
grant execute on function public.mes_create_operational_plan(text,timestamptz,timestamptz) to authenticated;

create or replace function public.mes_change_operational_plan_status(
  p_plan_id text,
  p_next_status text,
  p_expected_version integer default null
) returns operational_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan operational_plans%rowtype;
  v_before_status text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для изменения статуса операционного плана';
  end if;

  select * into v_plan from operational_plans where id=trim(p_plan_id) for update;
  if not found then raise exception 'Операционный план не найден: %',p_plan_id; end if;
  if p_expected_version is not null and v_plan.version<>p_expected_version then
    raise exception 'Версия плана устарела: ожидается %, фактически %',p_expected_version,v_plan.version;
  end if;
  if p_next_status not in ('DRAFT','RELEASED','ARCHIVED') then
    raise exception 'Недопустимый статус операционного плана: %',p_next_status;
  end if;
  if v_plan.status=p_next_status then return v_plan; end if;
  v_before_status:=v_plan.status;

  if p_next_status='RELEASED' then
    if v_plan.status<>'DRAFT' then raise exception 'Опубликовать можно только DRAFT план'; end if;
  elsif p_next_status='ARCHIVED' then
    if exists(select 1 from production_orders o where o.plan_id=v_plan.id and o.status not in ('COMPLETED','CANCELLED')) then
      raise exception 'Нельзя архивировать план с незавершенными производственными заказами';
    end if;
  elsif p_next_status='DRAFT' then
    raise exception 'Возврат RELEASED/ARCHIVED плана в DRAFT запрещен';
  end if;

  update operational_plans set status=p_next_status,version=version+1 where id=v_plan.id returning * into v_plan;

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values(auth.uid()::text,'OPERATIONAL_PLAN',v_plan.id,'PLAN_STATUS_CHANGED',
    jsonb_build_object('status',v_before_status,'version',v_plan.version-1),
    jsonb_build_object('status',v_plan.status,'version',v_plan.version));
  return v_plan;
end;
$$;

revoke all on function public.mes_change_operational_plan_status(text,text,integer) from public, anon;
grant execute on function public.mes_change_operational_plan_status(text,text,integer) to authenticated;

create or replace function public.mes_create_production_orders_from_request(
  p_request_id text,
  p_plan_id text,
  p_priority text default 'NORMAL',
  p_due_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request production_requests%rowtype;
  v_plan operational_plans%rowtype;
  v_item production_request_items%rowtype;
  v_order jsonb;
  v_order_id text;
  v_order_number text;
  v_due_at timestamptz;
  v_created integer := 0;
  v_existing integer := 0;
  v_planned integer := 0;
  v_blocked integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_plan_error text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для формирования производства';
  end if;
  if nullif(trim(p_request_id),'') is null or nullif(trim(p_plan_id),'') is null then
    raise exception 'Заявка и операционный план обязательны';
  end if;
  if coalesce(trim(p_priority),'') not in ('LOW','NORMAL','HIGH','URGENT') then
    raise exception 'Недопустимый приоритет заказа: %',p_priority;
  end if;

  select * into v_request from production_requests where id=trim(p_request_id) for update;
  if not found then raise exception 'Заявка не найдена: %',p_request_id; end if;
  if v_request.status='CANCELLED' then raise exception 'Нельзя сформировать производство из отменённой заявки'; end if;

  select * into v_plan from operational_plans where id=trim(p_plan_id) for update;
  if not found then raise exception 'Операционный план не найден: %',p_plan_id; end if;
  if v_plan.status='ARCHIVED' then raise exception 'Нельзя использовать архивный операционный план'; end if;

  if p_due_at is not null then v_due_at:=p_due_at;
  else v_due_at:=(v_request.desired_date + time '23:59:59')::timestamptz;
  end if;

  if v_due_at<=v_plan.horizon_start then raise exception 'Срок заказа должен быть после начала горизонта плана'; end if;
  if v_due_at>v_plan.horizon_end then raise exception 'Срок заказа выходит за горизонт операционного плана'; end if;

  for v_item in select * from production_request_items where request_id=v_request.id order by line_no loop
    v_order_id:=concat('ORD-',gen_random_uuid()::text);
    v_order_number:=concat(v_request.request_number,'-',lpad(v_item.line_no::text,2,'0'));

    select to_jsonb(o) into v_order
      from production_orders o
     where o.source_request_item_id=v_item.id and o.status<>'CANCELLED'
     order by o.number limit 1;

    if v_order is not null then
      v_existing:=v_existing+1;
      v_order_id:=v_order->>'id';
    else
      v_order:=mes_create_production_order_from_request_item(v_item.id,v_order_id,v_order_number,v_plan.id,v_due_at,trim(p_priority));
      v_created:=v_created+1;
      v_order_id:=v_order->>'orderId';
    end if;

    v_plan_error:=null;
    if (v_order->>'status') in ('IMPORTED','PLANNED','BLOCKED') then
      begin
        perform mes_plan_order(v_order_id);
        v_planned:=v_planned+1;
      exception when others then
        v_plan_error:=sqlerrm;
        v_blocked:=v_blocked+1;
        update production_orders set status='BLOCKED'
         where id=v_order_id and status in ('IMPORTED','PLANNED','BLOCKED');
        insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
        values(auth.uid()::text,'MES_PRODUCTION_ORDER',v_order_id,'ORDER_PLANNING_BLOCKED',
          jsonb_build_object('reason',v_plan_error,'planId',v_plan.id,'sourceRequestItemId',v_item.id));
      end;
    end if;

    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'requestItemId',v_item.id,'lineNo',v_item.line_no,'orderId',v_order_id,
      'orderNumber',coalesce(v_order->>'orderNumber',v_order_number),
      'created',coalesce(v_order->>'created','false')='true',
      'status',coalesce((select status from production_orders where id=v_order_id),v_order->>'status'),
      'planningError',v_plan_error
    ));
  end loop;

  update production_requests
     set status=case
       when exists(select 1 from production_request_items i where i.request_id=v_request.id
         and not exists(select 1 from production_orders o where o.source_request_item_id=i.id and o.status<>'CANCELLED'))
       then 'NEW' else 'PLANNED' end,
         updated_at=now()
   where id=v_request.id;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(auth.uid()::text,'PRODUCTION_REQUEST',v_request.id,'REQUEST_FORMED_FOR_PRODUCTION',
    jsonb_build_object('planId',v_plan.id,'priority',trim(p_priority),'dueAt',v_due_at,
      'createdOrders',v_created,'existingOrders',v_existing,'plannedOrders',v_planned,'blockedOrders',v_blocked));

  return jsonb_build_object('requestId',v_request.id,'requestNumber',v_request.request_number,'planId',v_plan.id,
    'createdOrders',v_created,'existingOrders',v_existing,'plannedOrders',v_planned,'blockedOrders',v_blocked,'results',v_results);
end;
$$;

revoke all on function public.mes_create_production_orders_from_request(text,text,text,timestamptz) from public, anon;
grant execute on function public.mes_create_production_orders_from_request(text,text,text,timestamptz) to authenticated;
