-- MES labor normalization.
-- Labor norms are human-hours (н-ч), while task planned_start/planned_end remain elapsed calendar time.
-- Existing run_minutes_per_unit is retained for backward compatibility and migrated once.

alter table route_operations
  add column if not exists labor_norm_hours_per_unit numeric(18,6),
  add column if not exists setup_norm_hours numeric(18,6),
  add column if not exists workers_required integer;

update route_operations
set
  labor_norm_hours_per_unit = coalesce(labor_norm_hours_per_unit, run_minutes_per_unit / 60.0),
  setup_norm_hours = coalesce(setup_norm_hours, setup_minutes / 60.0),
  workers_required = coalesce(workers_required, 1)
where labor_norm_hours_per_unit is null
   or setup_norm_hours is null
   or workers_required is null;

alter table route_operations
  alter column labor_norm_hours_per_unit set not null,
  alter column setup_norm_hours set not null,
  alter column workers_required set not null;

alter table route_operations
  add constraint route_operations_labor_norm_nonnegative
    check (labor_norm_hours_per_unit >= 0),
  add constraint route_operations_setup_norm_nonnegative
    check (setup_norm_hours >= 0),
  add constraint route_operations_workers_required_positive
    check (workers_required > 0),
  add constraint route_operations_has_norm
    check (labor_norm_hours_per_unit > 0 or setup_norm_hours > 0);

comment on column route_operations.labor_norm_hours_per_unit is 'Human labor norm in hours per one unit of output (н-ч/ед.)';
comment on column route_operations.setup_norm_hours is 'Human labor norm for setup/changeover of the operation (н-ч per setup)';
comment on column route_operations.workers_required is 'Number of employees working concurrently on the operation';
comment on column route_operations.run_minutes_per_unit is 'DEPRECATED compatibility field. New planning must use labor_norm_hours_per_unit.';
comment on column route_operations.setup_minutes is 'DEPRECATED compatibility field. New planning must use setup_norm_hours.';

-- Rebuild the task planning RPC so calendar duration is derived from labor norms.
-- For the MVP, concurrent workers convert human-hours to elapsed hours.
create or replace function mes_plan_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order production_orders%rowtype;
  v_operation route_operations%rowtype;
  v_plan_version integer;
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

  select * into v_order from production_orders where id = p_order_id for update;
  if not found then raise exception 'Производственный заказ не найден: %', p_order_id; end if;
  if v_order.status not in ('IMPORTED','PLANNED','BLOCKED') then
    raise exception 'Заказ нельзя планировать из статуса %', v_order.status;
  end if;

  select version into v_plan_version from operational_plans where id = v_order.plan_id;
  if v_plan_version is null then raise exception 'Операционный план заказа не найден'; end if;

  select count(*) into v_existing from production_tasks where order_id = v_order.id;
  if v_existing > 0 then
    update production_orders set status = 'PLANNED' where id = v_order.id;
    return jsonb_build_object('orderId', v_order.id, 'createdTasks', 0, 'existingTasks', v_existing, 'status', 'PLANNED');
  end if;

  if not exists (select 1 from route_operations where product_id = v_order.product_id and active) then
    raise exception 'Нельзя планировать заказ без активного технологического маршрута';
  end if;

  v_start := greatest(now(), v_order.due_at - interval '365 days');

  for v_operation in
    select * from route_operations
     where product_id = v_order.product_id and active
     order by sequence
  loop
    v_elapsed_hours := (v_operation.setup_norm_hours +
      (v_operation.labor_norm_hours_per_unit * greatest(v_order.quantity - v_order.completed_quantity, 0)))
      / v_operation.workers_required;

    if v_elapsed_hours <= 0 then
      raise exception 'Для операции % не задана трудовая норма', v_operation.id;
    end if;

    v_end := v_start + make_interval(secs => ceil(v_elapsed_hours * 3600)::integer);
    if v_end > v_order.due_at then
      raise exception 'Маршрут заказа % не помещается в срок после операции %', v_order.number, v_operation.code;
    end if;

    v_task_id := concat('TASK-', v_order.id, '-', v_operation.sequence);
    insert into production_tasks(
      id, order_id, operation_id, operation_sequence, status,
      planned_start, planned_end, planned_quantity, actual_quantity, version
    ) values (
      v_task_id, v_order.id, v_operation.id, v_operation.sequence, 'PLANNED',
      v_start, v_end, greatest(v_order.quantity - v_order.completed_quantity, 0.001), 0, 1
    );

    v_count := v_count + 1;
    v_start := v_end;
  end loop;

  update production_orders set status = 'PLANNED' where id = v_order.id;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'MES_PRODUCTION_ORDER',
    v_order.id,
    'ORDER_TASKS_PLANNED',
    jsonb_build_object('status', v_order.status, 'taskCount', 0),
    jsonb_build_object('status', 'PLANNED', 'taskCount', v_count)
  );

  return jsonb_build_object('orderId', v_order.id, 'createdTasks', v_count, 'status', 'PLANNED');
end;
$$;

grant execute on function mes_plan_order(text) to authenticated;
