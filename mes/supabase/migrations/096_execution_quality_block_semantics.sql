-- Align the database transition graph with the MES domain lifecycle and
-- guarantee that every new production result reopens the quality gate.

create or replace function can_transition_status(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case
    when p_from = 'DRAFT' and p_to = 'PLANNED' then true
    when p_from = 'DRAFT' and p_to = 'CANCELLED' then true
    when p_from = 'PLANNED' and p_to = 'ASSIGNED' then true
    when p_from = 'PLANNED' and p_to = 'CANCELLED' then true
    when p_from = 'ASSIGNED' and p_to = 'READY' then true
    when p_from = 'ASSIGNED' and p_to = 'PLANNED' then true
    when p_from = 'ASSIGNED' and p_to = 'CANCELLED' then true
    when p_from = 'READY' and p_to = 'RUNNING' then true
    when p_from = 'READY' and p_to = 'BLOCKED' then true
    when p_from = 'READY' and p_to = 'CANCELLED' then true
    when p_from = 'RUNNING' and p_to = 'PAUSED' then true
    when p_from = 'RUNNING' and p_to = 'BLOCKED' then true
    when p_from = 'RUNNING' and p_to = 'PARTIALLY_COMPLETED' then true
    when p_from = 'RUNNING' and p_to = 'COMPLETED' then true
    when p_from = 'PAUSED' and p_to = 'RUNNING' then true
    when p_from = 'PAUSED' and p_to = 'BLOCKED' then true
    when p_from = 'PAUSED' and p_to = 'CANCELLED' then true
    when p_from = 'BLOCKED' and p_to = 'READY' then true
    when p_from = 'BLOCKED' and p_to = 'ASSIGNED' then true
    when p_from = 'BLOCKED' and p_to = 'CANCELLED' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'RUNNING' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'COMPLETED' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'BLOCKED' then true
    else false
  end
$$;

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
  v_quality_required boolean;
  v_equipment_id text;
begin
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

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Задание уже завершено или отменено';
  end if;
  if v_task.status not in ('RUNNING','PARTIALLY_COMPLETED') then
    raise exception 'Регистрация факта разрешена только для выполняемого задания';
  end if;

  v_employee_id := mes_current_employee_id();
  if mes_current_role() = 'OPERATOR' and v_employee_id is null then
    raise exception 'Пользователь MES не привязан к сотруднику';
  end if;
  if mes_current_role() = 'OPERATOR' and not exists (
    select 1 from task_assignments a where a.task_id = p_task_id and a.employee_id = v_employee_id
  ) then
    raise exception 'Оператор не назначен на это задание';
  end if;

  if v_task.actual_quantity + p_good_quantity > v_task.planned_quantity then
    raise exception 'Факт выпуска превышает плановое количество';
  end if;

  for v_equipment_id in select value from jsonb_array_elements_text(coalesce(p_equipment_ids, '[]'::jsonb))
  loop
    if not exists (
      select 1 from task_assignments a where a.task_id = p_task_id and a.equipment_id = v_equipment_id
    ) then
      raise exception 'Оборудование % не назначено на это задание', v_equipment_id;
    end if;
    if not exists (select 1 from equipment e where e.id = v_equipment_id and e.active) then
      raise exception 'Оборудование % неактивно или не найдено', v_equipment_id;
    end if;
  end loop;

  v_new_actual := v_task.actual_quantity + p_good_quantity;
  v_quality_required := coalesce(v_task.quality_required, false);

  insert into production_results(
    id, task_id, recorded_at, good_quantity, scrap_quantity,
    employee_ids, equipment_ids, comment
  ) values (
    concat('RES-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id, p_recorded_at, p_good_quantity, p_scrap_quantity,
    case when v_employee_id is null then '[]'::jsonb else jsonb_build_array(v_employee_id) end,
    coalesce(p_equipment_ids, '[]'::jsonb), nullif(p_comment, '')
  ) returning * into v_result;

  update production_tasks
     set actual_quantity = v_new_actual,
         status = case when v_quality_required then 'PARTIALLY_COMPLETED'
                       when v_new_actual >= planned_quantity then 'COMPLETED'
                       else 'PARTIALLY_COMPLETED' end,
         actual_end = case when v_quality_required then null
                            when v_new_actual >= planned_quantity then coalesce(actual_end, p_recorded_at)
                            else actual_end end,
         quality_status = case when v_quality_required then 'PENDING' else quality_status end,
         version = version + 1
   where id = p_task_id;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id, 'RESULT_RECORDED', p_recorded_at, auth.uid()::text,
    jsonb_build_object(
      'resultId', v_result.id,
      'goodQuantity', p_good_quantity,
      'scrapQuantity', p_scrap_quantity,
      'employeeId', v_employee_id,
      'equipmentIds', coalesce(p_equipment_ids, '[]'::jsonb),
      'qualityGateReopened', v_quality_required,
      'role', mes_current_role()
    )
  );

  return v_result;
end;
$$;

grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz) to authenticated;
