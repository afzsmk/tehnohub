-- Keep production order execution facts derived from the latest technological
-- operation. Production results remain append-only; the task trigger turns the
-- accumulated last-operation quantity into authoritative order progress.

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

  update production_orders
     set completed_quantity = v_completed,
         status = v_new_status
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

grant execute on function mes_sync_order_from_task(text) to authenticated;

create or replace function mes_sync_order_after_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and (
        new.actual_quantity is distinct from old.actual_quantity
        or new.status is distinct from old.status
      )) then
    perform mes_sync_order_from_task(new.order_id);
  elsif tg_op = 'INSERT' then
    perform mes_sync_order_from_task(new.order_id);
  elsif tg_op = 'DELETE' then
    perform mes_sync_order_from_task(old.order_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists production_tasks_order_fact_sync on production_tasks;
create trigger production_tasks_order_fact_sync
after insert or update of actual_quantity, status or delete on production_tasks
for each row
execute function mes_sync_order_after_task_change();

-- Defense in depth: a production result is a real execution fact and therefore
-- must be recorded only while its task is actually being executed/resumed.
create or replace function mes_record_production_result(
  p_task_id text,
  p_good_quantity numeric,
  p_scrap_quantity numeric,
  p_equipment_ids jsonb default '[]'::jsonb,
  p_comment text default null,
  p_recorded_at timestamptz default now()
)
returns production_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_employee_id text;
  v_result production_results%rowtype;
  v_new_actual numeric;
  v_next_status text;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  if p_good_quantity < 0 or p_scrap_quantity < 0 or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество выпуска/брака';
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;

  if v_task.status not in ('RUNNING','PAUSED','PARTIALLY_COMPLETED') then
    raise exception 'Факт выпуска можно зарегистрировать только для выполняемого задания';
  end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;

  if mes_current_role() = 'OPERATOR' and not exists (
    select 1
      from task_assignments a
     where a.task_id = p_task_id
       and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  if v_task.actual_quantity + p_good_quantity > v_task.planned_quantity then
    raise exception 'Факт выпуска превышает плановое количество';
  end if;

  v_new_actual := v_task.actual_quantity + p_good_quantity;
  v_next_status := case
    when v_new_actual >= v_task.planned_quantity then 'COMPLETED'
    else 'PARTIALLY_COMPLETED'
  end;

  insert into production_results(
    id,
    task_id,
    recorded_at,
    good_quantity,
    scrap_quantity,
    employee_ids,
    equipment_ids,
    comment
  ) values (
    concat('RES-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    p_recorded_at,
    p_good_quantity,
    p_scrap_quantity,
    case when v_employee_id is null then '[]'::jsonb else jsonb_build_array(v_employee_id) end,
    coalesce(p_equipment_ids, '[]'::jsonb),
    nullif(p_comment, '')
  ) returning * into v_result;

  update production_tasks
     set actual_quantity = v_new_actual,
         status = v_next_status,
         actual_end = case
           when v_new_actual >= planned_quantity then coalesce(actual_end, p_recorded_at)
           else actual_end
         end,
         version = version + 1
   where id = p_task_id;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    'RESULT_RECORDED',
    p_recorded_at,
    auth.uid()::text,
    jsonb_build_object(
      'resultId', v_result.id,
      'goodQuantity', p_good_quantity,
      'scrapQuantity', p_scrap_quantity,
      'employeeId', v_employee_id,
      'role', mes_current_role()
    )
  );

  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;
