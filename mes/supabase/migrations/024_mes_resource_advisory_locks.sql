-- Serialize MES resource assignment across concurrent transactions.
-- Locks are acquired in deterministic resource order before any availability checks,
-- preventing two dispatchers from assigning the same employee/equipment at once.

create or replace function mes_assign_task(
  p_task_id text,
  p_employee_ids jsonb default null,
  p_equipment_ids jsonb default null,
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
  v_effective_employee_ids jsonb;
  v_effective_equipment_ids jsonb;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для назначения задания';
  end if;

  if p_employee_ids is not null and jsonb_typeof(p_employee_ids) <> 'array' then
    raise exception 'employeeIds должен быть массивом или null';
  end if;
  if p_equipment_ids is not null and jsonb_typeof(p_equipment_ids) <> 'array' then
    raise exception 'equipmentIds должен быть массивом или null';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_employee_ids, '[]'::jsonb)) item where jsonb_typeof(item) <> 'string')
     or exists (select 1 from jsonb_array_elements(coalesce(p_equipment_ids, '[]'::jsonb)) item where jsonb_typeof(item) <> 'string') then
    raise exception 'employeeIds и equipmentIds должны содержать только строки';
  end if;

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Нельзя менять назначения завершённого или отменённого задания';
  end if;
  if p_expected_version is not null and v_task.version <> p_expected_version then
    raise exception 'Версия задания устарела: ожидается %, фактически %', p_expected_version, v_task.version;
  end if;

  select o.product_id into v_product_id from production_orders o where o.id = v_task.order_id;
  if v_product_id is null then raise exception 'Продукт заказа задания не найден'; end if;

  select r.work_center, r.code, r.required_qualification, r.required_equipment_ids
    into v_operation_work_center, v_operation_code, v_required_qualification, v_required_equipment_ids
    from route_operations r
   where r.id = v_task.operation_id and r.product_id = v_product_id and r.active;
  if not found then
    raise exception 'Активная операция маршрута не найдена или не соответствует продукту заказа: %', v_task.operation_id;
  end if;

  select coalesce(jsonb_agg(a.employee_id order by a.employee_id) filter (where a.employee_id is not null), '[]'::jsonb),
         coalesce(jsonb_agg(a.equipment_id order by a.equipment_id) filter (where a.equipment_id is not null), '[]'::jsonb)
    into v_effective_employee_ids, v_effective_equipment_ids
    from task_assignments a
   where a.task_id = p_task_id;

  if p_employee_ids is not null then v_effective_employee_ids := p_employee_ids; end if;
  if p_equipment_ids is not null then v_effective_equipment_ids := p_equipment_ids; end if;

  select coalesce(array_agg(distinct value order by value), '{}'::text[])
    into v_unique_employees
    from jsonb_array_elements_text(v_effective_employee_ids) as value
   where trim(value) <> '';

  select coalesce(array_agg(distinct value order by value), '{}'::text[])
    into v_unique_equipment
    from jsonb_array_elements_text(v_effective_equipment_ids) as value
   where trim(value) <> '';

  -- Transaction-scoped advisory locks close the race between validation and insert.
  foreach v_employee_id in array v_unique_employees loop
    perform pg_advisory_xact_lock(hashtextextended('mes:employee:' || v_employee_id, 0));
  end loop;
  foreach v_equipment_id in array v_unique_equipment loop
    perform pg_advisory_xact_lock(hashtextextended('mes:equipment:' || v_equipment_id, 0));
  end loop;

  if v_required_qualification is not null and cardinality(v_unique_employees) = 0 then
    raise exception 'Для операции % требуется сотрудник с квалификацией не ниже %', v_operation_code, v_required_qualification;
  end if;

  foreach v_employee_id in array v_unique_employees loop
    if not exists (select 1 from employees where id = v_employee_id and active) then
      raise exception 'Активный сотрудник не найден: %', v_employee_id;
    end if;
    if v_required_qualification is not null and not exists (
      select 1 from employees where id = v_employee_id and active and qualification_level >= v_required_qualification
    ) then
      raise exception 'Сотрудник % не соответствует минимальной квалификации % для операции %', v_employee_id, v_required_qualification, v_operation_code;
    end if;
    if exists (
      select 1 from task_assignments a join production_tasks other_task on other_task.id = a.task_id
       where a.employee_id = v_employee_id and other_task.id <> v_task.id
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

    select e.capabilities into v_capabilities from equipment e where e.id = v_equipment_id;

    if exists (select 1 from equipment e where e.id = v_equipment_id and e.active and e.work_center <> v_operation_work_center) then
      raise exception 'Оборудование % относится к другому производственному участку', v_equipment_id;
    end if;

    if jsonb_array_length(coalesce(v_capabilities, '[]'::jsonb)) > 0
       and not (coalesce(v_capabilities, '[]'::jsonb) ? v_operation_code)
       and not (coalesce(v_capabilities, '[]'::jsonb) ? v_operation_work_center) then
      raise exception 'Оборудование % не имеет совместимой capability для операции %', v_equipment_id, v_operation_code;
    end if;

    if exists (
      select 1 from task_assignments a join production_tasks other_task on other_task.id = a.task_id
       where a.equipment_id = v_equipment_id and other_task.id <> v_task.id
         and other_task.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
         and tstzrange(other_task.planned_start, other_task.planned_end, '[)')
             && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
    ) then
      raise exception 'Оборудование % уже назначено на пересекающееся задание', v_equipment_id;
    end if;

    if exists (
      select 1 from equipment_blocks b
       where b.equipment_id = v_equipment_id
         and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
    ) then
      raise exception 'Оборудование % заблокировано на интервал задания', v_equipment_id;
    end if;

    if exists (
      select 1 from maintenance_orders m
       where m.equipment_id = v_equipment_id
         and m.status in ('PLANNED','IN_PROGRESS')
         and tstzrange(m.planned_start, m.planned_end, '[)') && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
    ) then
      raise exception 'На оборудовании % запланировано обслуживание, пересекающееся с заданием', v_equipment_id;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_required_equipment_ids, '[]'::jsonb)) required_id
    where not exists (
      select 1 from jsonb_array_elements_text(v_effective_equipment_ids) selected_id where selected_id = required_id
    )
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
       when status in ('PLANNED','BLOCKED') and (cardinality(v_unique_employees) > 0 or cardinality(v_unique_equipment) > 0) then 'ASSIGNED'
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

create index if not exists idx_task_assignments_employee_task
  on task_assignments(employee_id, task_id);
create index if not exists idx_task_assignments_equipment_task
  on task_assignments(equipment_id, task_id);
