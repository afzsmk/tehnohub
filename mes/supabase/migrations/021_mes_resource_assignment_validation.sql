-- Server-side MES resource validation.
-- Assignment is valid only when personnel/equipment match the route,
-- do not overlap other active tasks, and equipment is not blocked by maintenance.

create or replace function mes_assign_task(
  p_task_id text,
  p_employee_ids jsonb default '[]'::jsonb,
  p_equipment_ids jsonb default '[]'::jsonb,
  p_expected_version integer default null
)
returns production_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_actor text := auth.uid()::text;
  v_employee_id text;
  v_equipment_id text;
  v_before jsonb;
  v_after jsonb;
  v_unique_employees text[];
  v_unique_equipment text[];
  v_product_id text;
  v_operation_work_center text;
  v_operation_code text;
  v_required_qualification integer;
  v_required_equipment_ids jsonb;
  v_capabilities jsonb;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для назначения задания';
  end if;
  if jsonb_typeof(coalesce(p_employee_ids, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_equipment_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'employeeIds и equipmentIds должны быть массивами';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_employee_ids, '[]'::jsonb)) item
     where jsonb_typeof(item) <> 'string'
  ) or exists (
    select 1
      from jsonb_array_elements(coalesce(p_equipment_ids, '[]'::jsonb)) item
     where jsonb_typeof(item) <> 'string'
  ) then
    raise exception 'employeeIds и equipmentIds должны содержать только строки';
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception 'Задание не найдено: %', p_task_id;
  end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Нельзя менять назначения завершённого или отменённого задания';
  end if;
  if p_expected_version is not null and v_task.version <> p_expected_version then
    raise exception 'Версия задания устарела: ожидается %, фактически %', p_expected_version, v_task.version;
  end if;

  select o.product_id
    into v_product_id
    from production_orders o
   where o.id = v_task.order_id;
  if v_product_id is null then
    raise exception 'Продукт заказа задания не найден';
  end if;

  select r.work_center, r.code, r.required_qualification, r.required_equipment_ids
    into v_operation_work_center, v_operation_code, v_required_qualification, v_required_equipment_ids
    from route_operations r
   where r.id = v_task.operation_id
     and r.product_id = v_product_id
     and r.active;
  if not found then
    raise exception 'Активная операция маршрута не найдена или не соответствует продукту заказа: %', v_task.operation_id;
  end if;

  if v_required_qualification is not null and cardinality(coalesce(
      (select array_agg(distinct value order by value)
         from jsonb_array_elements_text(coalesce(p_employee_ids, '[]'::jsonb)) as value
        where trim(value) <> ''), '{}'::text[])) = 0 then
    raise exception 'Для операции % требуется сотрудник с квалификацией не ниже %', v_operation_code, v_required_qualification;
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::text[])
    into v_unique_employees
    from jsonb_array_elements_text(coalesce(p_employee_ids, '[]'::jsonb)) as value
   where trim(value) <> '';

  select coalesce(array_agg(distinct value order by value), '{}'::text[])
    into v_unique_equipment
    from jsonb_array_elements_text(coalesce(p_equipment_ids, '[]'::jsonb)) as value
   where trim(value) <> '';

  foreach v_employee_id in array v_unique_employees loop
    if not exists (select 1 from employees where id = v_employee_id and active) then
      raise exception 'Активный сотрудник не найден: %', v_employee_id;
    end if;
    if v_required_qualification is not null and not exists (
      select 1
        from employees
       where id = v_employee_id
         and active
         and qualification_level >= v_required_qualification
    ) then
      raise exception 'Сотрудник % не соответствует минимальной квалификации % для операции %',
        v_employee_id, v_required_qualification, v_operation_code;
    end if;
    if exists (
      select 1
        from task_assignments a
        join production_tasks other_task on other_task.id = a.task_id
       where a.employee_id = v_employee_id
         and other_task.id <> v_task.id
         and other_task.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
         and tstzrange(other_task.planned_start, other_task.planned_end, '[)')
             && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
    ) then
      raise exception 'Сотрудник % уже назначен на пересекающееся задание', v_employee_id;
    end if;
  end loop;

  foreach v_equipment_id in array v_unique_equipment loop
    if not exists (select 1 from equipment where id = v_equipment_id and active) then
      raise exception 'Активное оборудование не найдено: %', v_equipment_id;
    end if;

    select e.capabilities
      into v_capabilities
      from equipment e
     where e.id = v_equipment_id;

    if exists (
      select 1
        from equipment e
       where e.id = v_equipment_id
         and e.active
         and e.work_center <> v_operation_work_center
    ) then
      raise exception 'Оборудование % относится к участку %, а операция % — к участку %',
        v_equipment_id,
        (select e.work_center from equipment e where e.id = v_equipment_id),
        v_operation_code,
        v_operation_work_center;
    end if;

    if jsonb_array_length(coalesce(v_capabilities, '[]'::jsonb)) > 0
       and not (coalesce(v_capabilities, '[]'::jsonb) ? v_operation_code)
       and not (coalesce(v_capabilities, '[]'::jsonb) ? v_operation_work_center) then
      raise exception 'Оборудование % не имеет совместимой capability для операции %',
        v_equipment_id, v_operation_code;
    end if;

    if exists (
      select 1
        from jsonb_array_elements_text(coalesce(v_required_equipment_ids, '[]'::jsonb)) as required_id
       where required_id <> v_equipment_id
         and not (required_id = any(v_unique_equipment))
    ) then
      raise exception 'Для операции % не назначено обязательное оборудование %',
        v_operation_code,
        (select string_agg(required_id, ',')
           from jsonb_array_elements_text(coalesce(v_required_equipment_ids, '[]'::jsonb)) as required_id
          where not (required_id = any(v_unique_equipment)));
    end if;

    if exists (
      select 1
        from task_assignments a
        join production_tasks other_task on other_task.id = a.task_id
       where a.equipment_id = v_equipment_id
         and other_task.id <> v_task.id
         and other_task.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
         and tstzrange(other_task.planned_start, other_task.planned_end, '[)')
             && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
    ) then
      raise exception 'Оборудование % уже назначено на пересекающееся задание', v_equipment_id;
    end if;

    if exists (
      select 1 from equipment_blocks b
       where b.equipment_id = v_equipment_id
         and tstzrange(b.start_at, b.end_at, '[)')
             && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
    ) then
      raise exception 'Оборудование % заблокировано на интервал задания', v_equipment_id;
    end if;

    if exists (
      select 1
        from maintenance_orders m
       where m.equipment_id = v_equipment_id
         and m.status in ('PLANNED','IN_PROGRESS')
         and tstzrange(m.planned_start, m.planned_end, '[)')
             && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
    ) then
      raise exception 'На оборудовании % запланировано обслуживание, пересекающееся с заданием', v_equipment_id;
    end if;
  end loop;

  if jsonb_array_length(coalesce(v_required_equipment_ids, '[]'::jsonb)) > 0
     and not (
       select bool_and(required_id = any(v_unique_equipment))
         from jsonb_array_elements_text(v_required_equipment_ids) as required_id
     ) then
    raise exception 'Не все обязательные единицы оборудования назначены для операции %', v_operation_code;
  end if;

  v_before := jsonb_build_object(
    'status', v_task.status,
    'version', v_task.version,
    'employeeIds', coalesce((select jsonb_agg(a.employee_id order by a.employee_id) from task_assignments a where a.task_id = p_task_id and a.employee_id is not null), '[]'::jsonb),
    'equipmentIds', coalesce((select jsonb_agg(a.equipment_id order by a.equipment_id) from task_assignments a where a.task_id = p_task_id and a.equipment_id is not null), '[]'::jsonb)
  );

  delete from task_assignments where task_id = p_task_id;

  foreach v_employee_id in array v_unique_employees loop
    insert into task_assignments(task_id, employee_id) values (p_task_id, v_employee_id);
  end loop;
  foreach v_equipment_id in array v_unique_equipment loop
    insert into task_assignments(task_id, equipment_id) values (p_task_id, v_equipment_id);
  end loop;

  update production_tasks
     set status = case
       when status in ('PLANNED','BLOCKED') and (cardinality(v_unique_employees) > 0 or cardinality(v_unique_equipment) > 0)
         then 'ASSIGNED'
       else status
     end,
         version = version + 1
   where id = p_task_id
   returning * into v_task;

  v_after := jsonb_build_object(
    'status', v_task.status,
    'version', v_task.version,
    'employeeIds', to_jsonb(v_unique_employees),
    'equipmentIds', to_jsonb(v_unique_equipment)
  );

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_actor, 'PRODUCTION_TASK', p_task_id, 'ASSIGNMENT_CHANGED', v_before, v_after);

  return v_task;
end;
$$;

grant execute on function mes_assign_task(text,jsonb,jsonb,integer) to authenticated;

create or replace function mes_prepare_task(p_task_id text, p_expected_version integer default null)
returns production_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_product_id text;
  v_operation_work_center text;
  v_operation_code text;
  v_required_qualification integer;
  v_required_equipment_ids jsonb;
  v_employee_count integer;
  v_equipment_count integer;
  v_unqualified_employee text;
  v_missing_equipment text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для подготовки задания к выполнению';
  end if;

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if p_expected_version is not null and v_task.version <> p_expected_version then
    raise exception 'Версия задания устарела: ожидается %, фактически %', p_expected_version, v_task.version;
  end if;
  if v_task.status not in ('ASSIGNED','BLOCKED') then
    raise exception 'Задание должно иметь статус ASSIGNED или BLOCKED, фактически %', v_task.status;
  end if;

  select o.product_id into v_product_id from production_orders o where o.id = v_task.order_id;
  select r.work_center, r.code, r.required_qualification, r.required_equipment_ids
    into v_operation_work_center, v_operation_code, v_required_qualification, v_required_equipment_ids
    from route_operations r
   where r.id = v_task.operation_id and r.product_id = v_product_id and r.active;
  if not found then raise exception 'Активная операция маршрута не найдена для задания'; end if;

  select count(*) into v_employee_count from task_assignments where task_id = p_task_id and employee_id is not null;
  select count(*) into v_equipment_count from task_assignments where task_id = p_task_id and equipment_id is not null;
  if v_employee_count = 0 then raise exception 'Нельзя перевести задание READY без назначенного сотрудника'; end if;
  if v_equipment_count = 0 then raise exception 'Нельзя перевести задание READY без назначенного оборудования'; end if;

  if v_required_qualification is not null then
    select a.employee_id into v_unqualified_employee
      from task_assignments a
      join employees e on e.id = a.employee_id
     where a.task_id = p_task_id and a.employee_id is not null
       and (not e.active or e.qualification_level < v_required_qualification)
     limit 1;
    if v_unqualified_employee is not null then
      raise exception 'Сотрудник % не соответствует требованиям операции %', v_unqualified_employee, v_operation_code;
    end if;
  end if;

  select string_agg(required_id, ',') into v_missing_equipment
    from jsonb_array_elements_text(coalesce(v_required_equipment_ids, '[]'::jsonb)) as required_id
   where not exists (
     select 1 from task_assignments a where a.task_id = p_task_id and a.equipment_id = required_id
   );
  if v_missing_equipment is not null then
    raise exception 'Не назначено обязательное оборудование: %', v_missing_equipment;
  end if;

  if exists (
    select 1
      from task_assignments a
      join equipment e on e.id = a.equipment_id
     where a.task_id = p_task_id
       and (not e.active or e.work_center <> v_operation_work_center)
  ) then
    raise exception 'Назначенное оборудование не соответствует участку операции %', v_operation_code;
  end if;

  if exists (
    select 1
      from task_assignments a
      join production_tasks other_task on other_task.id <> p_task_id
     where a.task_id = p_task_id
       and other_task.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
       and tstzrange(other_task.planned_start, other_task.planned_end, '[)')
           && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
       and (
         a.employee_id in (select aa.employee_id from task_assignments aa where aa.task_id = other_task.id and aa.employee_id is not null)
         or a.equipment_id in (select aa.equipment_id from task_assignments aa where aa.task_id = other_task.id and aa.equipment_id is not null)
       )
  ) then
    raise exception 'Назначенные ресурсы пересекаются с другим активным заданием';
  end if;

  if exists (
    select 1
      from task_assignments a
      join equipment_blocks b on b.equipment_id = a.equipment_id
     where a.task_id = p_task_id
       and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
  ) then
    raise exception 'Назначенное оборудование заблокировано в интервале задания';
  end if;

  if exists (
    select 1
      from task_assignments a
      join maintenance_orders m on m.equipment_id = a.equipment_id
     where a.task_id = p_task_id
       and m.status in ('PLANNED','IN_PROGRESS')
       and tstzrange(m.planned_start, m.planned_end, '[)') && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
  ) then
    raise exception 'Назначенное оборудование занято обслуживанием в интервале задания';
  end if;

  update production_tasks
     set status = 'READY', version = version + 1
   where id = p_task_id
   returning * into v_task;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'PRODUCTION_TASK',
    p_task_id,
    'TASK_PREPARED',
    jsonb_build_object('status', v_task.status, 'version', v_task.version - 1),
    jsonb_build_object('status', 'READY', 'version', v_task.version)
  );

  return v_task;
end;
$$;

grant execute on function mes_prepare_task(text,integer) to authenticated;
