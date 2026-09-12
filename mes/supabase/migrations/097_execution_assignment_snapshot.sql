-- Resource snapshot hardening for production facts.
-- The client may omit equipment ids (the current shop-floor UI does); in that
-- case the authoritative task assignment is persisted with the fact.
-- Explicit equipment ids remain accepted only when each id is assigned to task.

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
  v_employee_ids jsonb;
  v_assigned_equipment_ids jsonb;
  v_effective_equipment_ids jsonb;
  v_employee_id text;
  v_result production_results%rowtype;
  v_new_actual numeric;
  v_quality_required boolean;
  v_equipment_id text;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  if p_good_quantity is null or p_scrap_quantity is null
     or p_good_quantity < 0 or p_scrap_quantity < 0
     or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество выпуска/брака';
  end if;

  if jsonb_typeof(coalesce(p_equipment_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'Идентификаторы оборудования должны быть строковым JSON-массивом';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_equipment_ids, '[]'::jsonb)) value
    where jsonb_typeof(value) <> 'string'
  ) then
    raise exception 'Идентификаторы оборудования должны быть строками';
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Задание уже завершено или отменено';
  end if;
  if v_task.status not in ('RUNNING','PARTIALLY_COMPLETED') then
    raise exception 'Регистрация факта разрешена только для выполняемого задания';
  end if;

  select coalesce(jsonb_agg(a.employee_id order by a.employee_id) filter (where a.employee_id is not null), '[]'::jsonb),
         coalesce(jsonb_agg(a.equipment_id order by a.equipment_id) filter (where a.equipment_id is not null), '[]'::jsonb)
    into v_employee_ids, v_assigned_equipment_ids
    from task_assignments a
   where a.task_id = p_task_id;

  if mes_current_role() = 'OPERATOR' then
    v_employee_id := mes_current_employee_id();
    if v_employee_id is null then
      raise exception 'Пользователь MES не привязан к сотруднику';
    end if;
    if not exists (
      select 1 from task_assignments a where a.task_id = p_task_id and a.employee_id = v_employee_id
    ) then
      raise exception 'Оператор не назначен на это задание';
    end if;
    v_employee_ids := jsonb_build_array(v_employee_id);
  end if;

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
      select 1 from task_assignments a where a.task_id = p_task_id and a.equipment_id = v_equipment_id
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
  v_quality_required := coalesce(v_task.quality_required, false);

  insert into production_results(
    id, task_id, recorded_at, good_quantity, scrap_quantity,
    employee_ids, equipment_ids, comment
  ) values (
    concat('RES-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    p_recorded_at,
    p_good_quantity,
    p_scrap_quantity,
    coalesce(v_employee_ids, '[]'::jsonb),
    coalesce(v_effective_equipment_ids, '[]'::jsonb),
    nullif(p_comment, '')
  ) returning * into v_result;

  update production_tasks
     set actual_quantity = v_new_actual,
         status = case
           when v_quality_required then 'PARTIALLY_COMPLETED'
           when v_new_actual >= planned_quantity then 'COMPLETED'
           else 'PARTIALLY_COMPLETED'
         end,
         actual_end = case
           when v_quality_required then null
           when v_new_actual >= planned_quantity then coalesce(actual_end, p_recorded_at)
           else actual_end
         end,
         quality_status = case when v_quality_required then 'PENDING' else quality_status end,
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
      'employeeIds', coalesce(v_employee_ids, '[]'::jsonb),
      'equipmentIds', coalesce(v_effective_equipment_ids, '[]'::jsonb),
      'qualityGateReopened', v_quality_required,
      'role', mes_current_role()
    )
  );

  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;
