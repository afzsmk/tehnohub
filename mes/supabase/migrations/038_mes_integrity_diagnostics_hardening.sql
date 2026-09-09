-- MES integrity diagnostics hardening.
-- Detect impossible completion, missing mandatory QA approval and invalid
-- order/task fact synchronization states. The function remains read-only.

create or replace function mes_check_operational_integrity()
returns jsonb
language plpgsql
security definer
set search_path = public
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

comment on function mes_check_operational_integrity() is
'Read-only MES integrity diagnostics with completion/quality/fact consistency checks.';
