-- MES order release/completion integrity.
-- A released order must have executable tasks for every active route operation.
-- A completed order must have all non-cancelled tasks complete and its fact at plan.

create or replace function mes_assert_order_route_completeness(p_order_id text, p_target_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id text;
  v_missing integer;
  v_incomplete integer;
  v_quality_pending integer;
  v_completed_quantity numeric;
  v_order_quantity numeric;
begin
  select product_id, quantity, completed_quantity
    into v_product_id, v_order_quantity, v_completed_quantity
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
    if v_completed_quantity < v_order_quantity then
      raise exception 'MES: заказ % нельзя завершить: факт % меньше плана %', p_order_id, v_completed_quantity, v_order_quantity;
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

grant execute on function mes_assert_order_route_completeness(text,text) to authenticated;

create or replace function mes_validate_order_status_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    perform mes_assert_order_route_completeness(new.id, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists mes_order_status_integrity on production_orders;
create trigger mes_order_status_integrity
before update of status on production_orders
for each row execute function mes_validate_order_status_integrity();

create or replace function mes_check_operational_integrity()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_violations jsonb;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER','ANALYST','QUALITY','MAINTENANCE']) then
    raise exception 'Недостаточно прав для диагностики MES';
  end if;

  with violations as (
    select t.id entity_id, 'TASK_OVER_PLAN' code, 'MES_PRODUCTION_TASK' entity_type,
           format('Факт задания %s превышает план %s', t.actual_quantity, t.planned_quantity) message
      from production_tasks t
     where t.actual_quantity > t.planned_quantity

    union all
    select t.id, 'COMPLETED_UNDER_PLAN', 'MES_PRODUCTION_TASK',
           format('Завершённое задание выполнено не полностью: %s из %s', t.actual_quantity, t.planned_quantity)
      from production_tasks t
     where t.status = 'COMPLETED' and t.actual_quantity < t.planned_quantity

    union all
    select t.id, 'COMPLETED_WITHOUT_QUALITY', 'MES_PRODUCTION_TASK',
           'Задание завершено без обязательного одобрения ОТК'
      from production_tasks t
     where t.status = 'COMPLETED' and t.quality_required and t.quality_status <> 'APPROVED'

    union all
    select t.id, 'TASK_ROUTE_MISMATCH', 'MES_PRODUCTION_TASK',
           'Задание не соответствует продукту заказа или последовательности технологического маршрута'
      from production_tasks t
      left join production_orders o on o.id = t.order_id
      left join route_operations r on r.id = t.operation_id
     where o.id is null
        or r.id is null
        or o.product_id <> r.product_id
        or t.operation_sequence <> r.sequence

    union all
    select o.id, 'ORDER_OVER_PLAN', 'MES_PRODUCTION_ORDER',
           format('Факт заказа %s превышает план %s', o.completed_quantity, o.quantity)
      from production_orders o
     where o.completed_quantity > o.quantity

    union all
    select o.id, 'ORDER_FACT_MISMATCH', 'MES_PRODUCTION_ORDER',
           format('Факт заказа %s не совпадает с последней технологической операцией %s', o.completed_quantity, latest.latest_quantity)
      from production_orders o
      join lateral (
        select coalesce(sum(t.actual_quantity), 0) latest_quantity
          from production_tasks t
         where t.order_id = o.id
           and t.operation_sequence = (
             select max(t2.operation_sequence)
               from production_tasks t2
              where t2.order_id = o.id and t2.status <> 'CANCELLED'
           )
           and t.status <> 'CANCELLED'
      ) latest on true
     where o.status <> 'CANCELLED'
       and o.completed_quantity <> least(o.quantity, greatest(0, latest.latest_quantity))

    union all
    select o.id, 'RELEASED_MISSING_ROUTE_TASKS', 'MES_PRODUCTION_ORDER',
           format('Выпущенный заказ не имеет заданий по %s активным операциям маршрута', missing.missing_count)
      from production_orders o
      join lateral (
        select count(*) missing_count
          from route_operations r
         where r.product_id = o.product_id
           and r.active
           and not exists (
             select 1 from production_tasks t
              where t.order_id = o.id
                and t.operation_id = r.id
                and t.status <> 'CANCELLED'
           )
      ) missing on missing.missing_count > 0
     where o.status in ('RELEASED','IN_EXECUTION','PARTIALLY_COMPLETED','COMPLETED')

    union all
    select a.task_id, 'INACTIVE_EMPLOYEE_ASSIGNMENT', 'MES_TASK_ASSIGNMENT',
           format('К заданию назначен неактивный сотрудник %s', a.employee_id)
      from task_assignments a join employees e on e.id = a.employee_id
     where a.employee_id is not null and not e.active

    union all
    select a.task_id, 'INACTIVE_EQUIPMENT_ASSIGNMENT', 'MES_TASK_ASSIGNMENT',
           format('К заданию назначено неактивное оборудование %s', a.equipment_id)
      from task_assignments a join equipment e on e.id = a.equipment_id
     where a.equipment_id is not null and not e.active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityId', entity_id,
    'entityType', entity_type,
    'code', code,
    'message', message
  ) order by entity_type, entity_id, code), '[]'::jsonb)
    into v_violations
    from violations;

  v_count := jsonb_array_length(v_violations);
  return jsonb_build_object(
    'ok', v_count = 0,
    'checkedAt', now(),
    'violationCount', v_count,
    'violations', v_violations
  );
end;
$$;

grant execute on function mes_check_operational_integrity() to authenticated;

comment on function mes_assert_order_route_completeness(text,text) is
'Validates that released/executing/completed orders have tasks for every active route operation and that completed orders are fully complete and quality-approved.';
comment on function mes_check_operational_integrity() is
'Read-only MES integrity diagnostics covering task-route consistency, order fact consistency, completion/quality and assignments.';
