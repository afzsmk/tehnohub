-- Planning uses the selected operational plan horizon instead of an arbitrary 365-day backstop.

create or replace function public.mes_plan_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order production_orders%rowtype;
  v_plan operational_plans%rowtype;
  v_operation route_operations%rowtype;
  v_task_id text;
  v_count integer := 0;
  v_existing integer := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_elapsed_hours numeric;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для планирования заказа';
  end if;
  select * into v_order from production_orders where id=p_order_id for update;
  if not found then raise exception 'Производственный заказ не найден: %',p_order_id; end if;
  if v_order.status not in ('IMPORTED','PLANNED','BLOCKED') then raise exception 'Заказ нельзя планировать из статуса %',v_order.status; end if;

  select * into v_plan from operational_plans where id=v_order.plan_id;
  if not found then raise exception 'Операционный план заказа не найден'; end if;
  if v_plan.status='ARCHIVED' then raise exception 'Нельзя планировать заказ в архивном плане'; end if;

  select count(*) into v_existing from production_tasks where order_id=v_order.id;
  if v_existing>0 then
    update production_orders set status='PLANNED' where id=v_order.id;
    return jsonb_build_object('orderId',v_order.id,'createdTasks',0,'existingTasks',v_existing,'status','PLANNED');
  end if;

  if not exists(select 1 from route_operations where product_id=v_order.product_id and active) then
    raise exception 'Нельзя планировать заказ без активного технологического маршрута';
  end if;

  v_start:=greatest(now(),v_plan.horizon_start);
  if v_start>=v_order.due_at then raise exception 'Для заказа % не осталось времени в горизонте плана',v_order.number; end if;

  for v_operation in select * from route_operations where product_id=v_order.product_id and active order by sequence loop
    v_elapsed_hours:=(v_operation.setup_norm_hours+
      (v_operation.labor_norm_hours_per_unit*greatest(v_order.quantity-v_order.completed_quantity,0)))
      / greatest(v_operation.workers_required,1);
    if v_elapsed_hours<=0 then raise exception 'Для операции % не задана трудовая норма',v_operation.id; end if;

    v_end:=v_start+make_interval(secs=>ceil(v_elapsed_hours*3600)::integer);
    if v_end>v_order.due_at or v_end>v_plan.horizon_end then
      raise exception 'Маршрут заказа % не помещается в срок/горизонт после операции %',v_order.number,v_operation.code;
    end if;

    v_task_id:=concat('TASK-',v_order.id,'-',v_operation.sequence);
    insert into production_tasks(id,order_id,operation_id,operation_sequence,status,planned_start,planned_end,planned_quantity,actual_quantity,version)
    values(v_task_id,v_order.id,v_operation.id,v_operation.sequence,'PLANNED',v_start,v_end,
      greatest(v_order.quantity-v_order.completed_quantity,0.001),0,1);
    v_count:=v_count+1;
    v_start:=v_end;
  end loop;

  update production_orders set status='PLANNED' where id=v_order.id;
  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values(auth.uid()::text,'MES_PRODUCTION_ORDER',v_order.id,'ORDER_TASKS_PLANNED',
    jsonb_build_object('status',v_order.status,'taskCount',0),
    jsonb_build_object('status','PLANNED','taskCount',v_count,'planId',v_plan.id,'planVersion',v_plan.version));
  return jsonb_build_object('orderId',v_order.id,'createdTasks',v_count,'status','PLANNED');
end;
$$;

revoke all on function public.mes_plan_order(text) from public, anon;
grant execute on function public.mes_plan_order(text) to authenticated;
