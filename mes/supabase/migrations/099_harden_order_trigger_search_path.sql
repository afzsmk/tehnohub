-- Keep SECURITY DEFINER order-completion helpers on the MES public schema only.
-- The security regression contract requires an exact `search_path=public` pin.

create or replace function mes_assert_order_route_completeness_values(
  p_order_id text,
  p_target_status text,
  p_completed_quantity numeric,
  p_order_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id text;
  v_missing integer;
  v_incomplete integer;
  v_quality_pending integer;
begin
  select product_id
    into v_product_id
    from production_orders
   where id = p_order_id;

  if v_product_id is null then
    raise exception 'MES: производственный заказ не найден: %', p_order_id;
  end if;

  if p_target_status in ('RELEASED','IN_EXECUTION','PARTIALLY_COMPLETED','COMPLETED') then
    select count(*)
      into v_missing
      from route_operations route
     where route.product_id = v_product_id
       and route.active
       and not exists (
         select 1
           from production_tasks task
          where task.order_id = p_order_id
            and task.operation_id = route.id
            and task.status <> 'CANCELLED'
       );

    if v_missing > 0 then
      raise exception 'MES: заказ % не имеет производственных заданий для % активных операций маршрута', p_order_id, v_missing;
    end if;
  end if;

  if p_target_status = 'COMPLETED' then
    if coalesce(p_completed_quantity, 0) < coalesce(p_order_quantity, 0) then
      raise exception 'MES: заказ % нельзя завершить: факт % меньше плана %', p_order_id, coalesce(p_completed_quantity, 0), coalesce(p_order_quantity, 0);
    end if;

    select count(*)
      into v_incomplete
      from production_tasks task
     where task.order_id = p_order_id
       and task.status <> 'CANCELLED'
       and task.status <> 'COMPLETED';
    if v_incomplete > 0 then
      raise exception 'MES: заказ % содержит % незавершённых производственных заданий', p_order_id, v_incomplete;
    end if;

    select count(*)
      into v_quality_pending
      from production_tasks task
     where task.order_id = p_order_id
       and task.status <> 'CANCELLED'
       and task.quality_required
       and task.quality_status <> 'APPROVED';
    if v_quality_pending > 0 then
      raise exception 'MES: заказ % содержит % заданий без одобрения ОТК', p_order_id, v_quality_pending;
    end if;
  end if;
end;
$$;

create or replace function mes_validate_order_status_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform mes_assert_order_route_completeness_values(
      new.id,
      new.status,
      new.completed_quantity,
      new.quantity
    );
  end if;
  return new;
end;
$$;

-- Preserve trigger-only execution for the internal value-aware helper.
revoke all on function mes_assert_order_route_completeness_values(text,text,numeric,numeric) from public, anon, authenticated;
