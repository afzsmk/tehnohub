-- Revalidate the current assignment immediately before READY.
-- This closes the window where an employee/equipment can become invalid
-- after ASSIGNED but before execution starts.

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
  v_bad_employee text;
  v_bad_equipment text;
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
  if v_product_id is null then raise exception 'Продукт заказа задания не найден'; end if;

  select r.work_center, r.code, r.required_qualification, r.required_equipment_ids
    into v_operation_work_center, v_operation_code, v_required_qualification, v_required_equipment_ids
    from route_operations r
   where r.id = v_task.operation_id and r.product_id = v_product_id and r.active;
  if not found then raise exception 'Активная операция маршрута не найдена для задания'; end if;

  select count(*) into v_employee_count from task_assignments where task_id = p_task_id and employee_id is not null;
  select count(*) into v_equipment_count from task_assignments where task_id = p_task_id and equipment_id is not null;
  if v_employee_count = 0 then raise exception 'Нельзя перевести задание READY без назначенного сотрудника'; end if;
  if v_equipment_count = 0 then raise exception 'Нельзя перевести задание READY без назначенного оборудования'; end if;

  select a.employee_id into v_bad_employee
    from task_assignments a
    left join employees e on e.id = a.employee_id
   where a.task_id = p_task_id
     and a.employee_id is not null
     and (e.id is null or not e.active or (v_required_qualification is not null and e.qualification_level < v_required_qualification))
   limit 1;
  if v_bad_employee is not null then
    raise exception 'Сотрудник % не соответствует требованиям операции %', v_bad_employee, v_operation_code;
  end if;

  select a.equipment_id into v_bad_equipment
    from task_assignments a
    left join equipment e on e.id = a.equipment_id
   where a.task_id = p_task_id
     and a.equipment_id is not null
     and (e.id is null or not e.active or e.work_center <> v_operation_work_center)
   limit 1;
  if v_bad_equipment is not null then
    raise exception 'Оборудование % не соответствует требованиям операции %', v_bad_equipment, v_operation_code;
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
       and jsonb_array_length(coalesce(e.capabilities, '[]'::jsonb)) > 0
       and not (coalesce(e.capabilities, '[]'::jsonb) ? v_operation_code)
       and not (coalesce(e.capabilities, '[]'::jsonb) ? v_operation_work_center)
  ) then
    raise exception 'Назначенное оборудование не поддерживает операцию %', v_operation_code;
  end if;

  if exists (
    select 1
      from task_assignments a
      join production_tasks other_task on other_task.id <> p_task_id
      join task_assignments other_assignment
        on other_assignment.task_id = other_task.id
       and (
         (a.employee_id is not null and other_assignment.employee_id = a.employee_id)
         or (a.equipment_id is not null and other_assignment.equipment_id = a.equipment_id)
       )
     where a.task_id = p_task_id
       and other_task.status in ('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
       and tstzrange(other_task.planned_start, other_task.planned_end, '[)')
           && tstzrange(v_task.planned_start, v_task.planned_end, '[)')
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
    jsonb_build_object('status', 'ASSIGNED', 'version', v_task.version - 1),
    jsonb_build_object('status', 'READY', 'version', v_task.version)
  );

  return v_task;
end;
$$;

grant execute on function mes_prepare_task(text,integer) to authenticated;
