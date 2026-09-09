-- Harden automatic Order <- Task fact synchronization introduced by 026.
-- The sync helper is trigger-internal and must not be callable as a write API.

revoke execute on function mes_sync_order_from_task(text) from public, authenticated;

create or replace function mes_sync_order_from_task(p_order_id text)
returns production_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order production_orders%rowtype;
  v_before_status text;
  v_before_completed numeric;
  v_latest_sequence integer;
  v_completed numeric;
  v_any_execution boolean;
  v_new_status text;
begin
  select * into v_order
    from production_orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Производственный заказ не найден: %', p_order_id;
  end if;

  v_before_status := v_order.status;
  v_before_completed := v_order.completed_quantity;

  select max(t.operation_sequence)
    into v_latest_sequence
    from production_tasks t
   where t.order_id = p_order_id
     and t.status <> 'CANCELLED';

  if v_latest_sequence is null then
    return v_order;
  end if;

  select coalesce(sum(t.actual_quantity), 0)
    into v_completed
    from production_tasks t
   where t.order_id = p_order_id
     and t.operation_sequence = v_latest_sequence
     and t.status <> 'CANCELLED';

  select exists (
    select 1
      from production_tasks t
     where t.order_id = p_order_id
       and t.status in ('RUNNING','PAUSED','PARTIALLY_COMPLETED','COMPLETED')
  ) into v_any_execution;

  v_completed := least(v_order.quantity, greatest(0, v_completed));

  v_new_status := case
    when v_completed >= v_order.quantity then 'COMPLETED'
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

  if v_completed = v_before_completed and v_new_status = v_before_status then
    return v_order;
  end if;

  update production_orders
     set completed_quantity = v_completed,
         status = v_new_status
   where id = p_order_id
   returning * into v_order;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    coalesce(auth.uid()::text, 'MES_SYSTEM'),
    'MES_PRODUCTION_ORDER',
    v_order.id,
    'ORDER_FACT_SYNCED',
    jsonb_build_object(
      'status', v_before_status,
      'completedQuantity', v_before_completed,
      'source', 'PRODUCTION_TASK'
    ),
    jsonb_build_object(
      'status', v_order.status,
      'completedQuantity', v_order.completed_quantity,
      'source', 'PRODUCTION_TASK',
      'latestOperationSequence', v_latest_sequence
    )
  );

  return v_order;
end;
$$;

revoke execute on function mes_sync_order_from_task(text) from public, authenticated;
