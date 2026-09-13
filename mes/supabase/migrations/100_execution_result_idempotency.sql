-- Transactional idempotency for production facts.
-- A shop-floor submission must remain a single business operation across retries,
-- duplicate clicks, network timeouts, and concurrent clients.

alter table production_results
  add column if not exists idempotency_key text;

create unique index if not exists uq_production_results_idempotency_key
  on production_results(idempotency_key)
  where idempotency_key is not null;

drop function if exists mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz);

create or replace function mes_record_production_result(
  p_task_id text,
  p_good_quantity numeric,
  p_scrap_quantity numeric,
  p_equipment_ids jsonb default '[]'::jsonb,
  p_comment text default null,
  p_recorded_at timestamptz default now(),
  p_idempotency_key text default null
)
returns production_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_employee_ids jsonb;
  v_assigned_equipment_ids jsonb;
  v_effective_equipment_ids jsonb;
  v_employee_id text;
  v_plan_id text;
  v_result production_results%rowtype;
  v_existing_result production_results%rowtype;
  v_new_actual numeric;
  v_quality_gate boolean;
  v_equipment_id text;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER','OPERATOR']) then
    raise exception 'Недостаточно прав для регистрации выпуска';
  end if;
  if p_good_quantity is null or p_scrap_quantity is null
     or p_good_quantity < 0 or p_scrap_quantity < 0
     or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество выпуска/брака';
  end if;
  if p_recorded_at is null then
    raise exception 'Время регистрации не должно быть null';
  end if;
  if v_key is not null and length(v_key) > 200 then
    raise exception 'Ключ идемпотентности слишком длинный';
  end if;

  if p_equipment_ids is not null and jsonb_typeof(p_equipment_ids) <> 'array' then
    raise exception 'equipmentIds должен быть массивом или null';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_equipment_ids, '[]'::jsonb)) item
     where jsonb_typeof(item) <> 'string'
  ) then
    raise exception 'equipmentIds должен содержать только строки';
  end if;

  -- Fast replay path. The unique key is the business-operation boundary;
  -- no task/order/event side effects are re-applied on a retry.
  if v_key is not null then
    select * into v_existing_result
      from production_results
     where idempotency_key = v_key;
    if found then
      if v_existing_result.task_id <> p_task_id
         or v_existing_result.good_quantity <> p_good_quantity
         or v_existing_result.scrap_quantity <> p_scrap_quantity then
        raise exception 'Ключ идемпотентности уже используется для другого результата';
      end if;
      return v_existing_result;
    end if;
  end if;

  -- Serialize execution facts against assignment/replan mutations on the same
  -- operational plan, then serialize the task itself.
  select o.plan_id
    into v_plan_id
    from production_tasks t
    join production_orders o on o.id = t.order_id
   where t.id = p_task_id;
  if v_plan_id is null then
    raise exception 'Операционный план задания не найден: %', p_task_id;
  end if;

  perform 1
    from operational_plans
   where id = v_plan_id
   for update;
  if not found then
    raise exception 'Операционный план не найден: %', v_plan_id;
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;
  if v_task.status in ('CANCELLED','DRAFT','PLANNED','ASSIGNED','READY') then
    raise exception 'Регистрация выпуска разрешена только для выполняемого задания';
  end if;
  if v_task.status = 'COMPLETED' then
    raise exception 'Нельзя регистрировать выпуск для уже завершённого задания';
  end if;
  if v_task.actual_start is not null and p_recorded_at < v_task.actual_start then
    raise exception 'Время выпуска раньше фактического начала задания';
  end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;
  if mes_current_role() = 'OPERATOR' and not exists (
    select 1 from task_assignments a
     where a.task_id = p_task_id and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  select coalesce(jsonb_agg(a.employee_id order by a.employee_id) filter (where a.employee_id is not null), '[]'::jsonb),
         coalesce(jsonb_agg(a.equipment_id order by a.equipment_id) filter (where a.equipment_id is not null), '[]'::jsonb)
    into v_employee_ids, v_assigned_equipment_ids
    from task_assignments a
   where a.task_id = p_task_id;

  if jsonb_array_length(coalesce(p_equipment_ids, '[]'::jsonb)) = 0 then
    v_effective_equipment_ids := v_assigned_equipment_ids;
  else
    v_effective_equipment_ids := (
      select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
        from jsonb_array_elements_text(p_equipment_ids) as value
    );
  end if;

  for v_equipment_id in
    select value from jsonb_array_elements_text(coalesce(v_effective_equipment_ids, '[]'::jsonb))
  loop
    if not exists (
      select 1 from task_assignments a
       where a.task_id = p_task_id and a.equipment_id = v_equipment_id
    ) then
      raise exception 'Оборудование % не назначено на это задание', v_equipment_id;
    end if;
    if not exists (
      select 1 from equipment e where e.id = v_equipment_id and e.active
    ) then
      raise exception 'Оборудование % неактивно или не найдено', v_equipment_id;
    end if;
  end loop;

  if jsonb_array_length(coalesce(v_effective_equipment_ids, '[]'::jsonb)) = 0 then
    raise exception 'Для регистрации факта требуется назначенное оборудование';
  end if;

  if v_task.actual_quantity + p_good_quantity > v_task.planned_quantity then
    raise exception 'Факт выпуска превышает плановое количество';
  end if;

  v_new_actual := v_task.actual_quantity + p_good_quantity;
  v_quality_gate := coalesce(v_task.quality_required, false)
                    and coalesce(v_task.quality_status, 'NOT_REQUIRED') <> 'APPROVED';

  insert into production_results(
    id, task_id, recorded_at, good_quantity, scrap_quantity,
    employee_ids, equipment_ids, comment, idempotency_key
  ) values (
    concat('RES-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    p_recorded_at,
    p_good_quantity,
    p_scrap_quantity,
    case when mes_current_role() = 'OPERATOR' then jsonb_build_array(v_employee_id) else coalesce(v_employee_ids, '[]'::jsonb) end,
    coalesce(v_effective_equipment_ids, '[]'::jsonb),
    nullif(p_comment, ''),
    v_key
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning * into v_result;

  if v_result.id is null then
    select * into v_existing_result
      from production_results
     where idempotency_key = v_key;
    if not found then
      raise exception 'MES: идемпотентный результат не найден после конфликтной вставки';
    end if;
    if v_existing_result.task_id <> p_task_id
       or v_existing_result.good_quantity <> p_good_quantity
       or v_existing_result.scrap_quantity <> p_scrap_quantity then
      raise exception 'Ключ идемпотентности уже используется для другого результата';
    end if;
    return v_existing_result;
  end if;

  update production_tasks
     set actual_quantity = v_new_actual,
         status = case
           when v_new_actual >= planned_quantity and v_quality_gate then 'PARTIALLY_COMPLETED'
           when v_new_actual >= planned_quantity then 'COMPLETED'
           else 'PARTIALLY_COMPLETED'
         end,
         actual_end = case
           when v_new_actual >= planned_quantity and not v_quality_gate
             then coalesce(actual_end, p_recorded_at)
           else actual_end
         end,
         quality_status = case
           when v_quality_gate or coalesce(quality_required, false) then 'PENDING'
           else quality_status
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
      'employeeIds', case when mes_current_role() = 'OPERATOR' then jsonb_build_array(v_employee_id) else coalesce(v_employee_ids, '[]'::jsonb) end,
      'equipmentIds', coalesce(v_effective_equipment_ids, '[]'::jsonb),
      'qualityGateReopened', v_quality_gate,
      'role', mes_current_role(),
      'idempotencyKey', v_key
    )
  );

  return v_result;
end;
$$;

revoke execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz,text) from public;
revoke execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz,text) from anon;
grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz,text) to authenticated;
