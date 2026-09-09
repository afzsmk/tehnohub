-- Server-side task assignment for MES dispatching.
-- Assignment changes are version-checked and audited; operators cannot reassign work.

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
  end loop;

  foreach v_equipment_id in array v_unique_equipment loop
    if not exists (select 1 from equipment where id = v_equipment_id and active) then
      raise exception 'Активное оборудование не найдено: %', v_equipment_id;
    end if;
  end loop;

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
     set status = case when status = 'PLANNED' and (cardinality(v_unique_employees) > 0 or cardinality(v_unique_equipment) > 0) then 'ASSIGNED' else status end,
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
