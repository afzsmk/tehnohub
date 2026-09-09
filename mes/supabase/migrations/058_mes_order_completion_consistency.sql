-- MES order completion consistency hardening.
-- Full production quantity alone does not make an order COMPLETE: every active
-- task on the latest technological operation must also be COMPLETED. This keeps
-- the order in PARTIALLY_COMPLETED while the final quantity waits for Quality Gate
-- approval, then lets the approved task transition atomically complete the order.

create or replace function mes_sync_order_from_task(p_order_id text)
returns production_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order production_orders%rowtype;
  v_latest_sequence integer;
  v_completed numeric;
  v_any_execution boolean;
  v_latest_incomplete boolean;
  v_new_status text;
begin
  select * into v_order
    from production_orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Производственный заказ не найден: %', p_order_id;
  end if;

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

  select exists (
    select 1
      from production_tasks t
     where t.order_id = p_order_id
       and t.operation_sequence = v_latest_sequence
       and t.status <> 'CANCELLED'
       and (t.status <> 'COMPLETED' or (t.quality_required and t.quality_status <> 'APPROVED'))
  ) into v_latest_incomplete;

  v_completed := least(v_order.quantity, greatest(0, v_completed));

  v_new_status := case
    when v_completed >= v_order.quantity and not v_latest_incomplete then 'COMPLETED'
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

  return v_order;
end;
$$;

grant execute on function mes_sync_order_from_task(text) to authenticated;

comment on function mes_sync_order_from_task(text) is
'Authoritative MES order progress from latest operation; full fact reaches COMPLETED only when all latest-operation tasks are completed and quality-approved.';
