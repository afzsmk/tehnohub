-- Normalized route-operation write API.
-- Keeps legacy mes_master_save_route_operation for compatibility, while new UI/import
-- flows can bind operations to route/work-center/qualification entities explicitly.

create or replace function mes_master_save_route_operation_v2(
  p_id text,
  p_route_id text,
  p_sequence integer,
  p_code text,
  p_name text,
  p_work_center_id text,
  p_required_qualification_id text,
  p_required_equipment_ids jsonb,
  p_setup_norm_hours numeric,
  p_labor_norm_hours_per_unit numeric,
  p_workers_required integer,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r route_operations%rowtype;
  v_product_id text;
  v_work_center text;
  v_qualification_level integer;
  v_equipment_id text;
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null
     or nullif(trim(p_route_id),'') is null
     or nullif(trim(p_code),'') is null
     or nullif(trim(p_name),'') is null
     or nullif(trim(p_work_center_id),'') is null
  then
    raise exception 'Обязательные поля нормализованной операции не заполнены';
  end if;

  select product_id into v_product_id
    from routes
   where id = trim(p_route_id)
     and active = true;
  if v_product_id is null then
    raise exception 'Активный маршрут не найден: %', p_route_id;
  end if;

  select name into v_work_center
    from work_centers
   where id = trim(p_work_center_id)
     and active = true;
  if v_work_center is null then
    raise exception 'Активный рабочий центр не найден: %', p_work_center_id;
  end if;

  if p_required_qualification_id is not null then
    select level into v_qualification_level
      from qualification_levels
     where id = trim(p_required_qualification_id)
       and active = true;
    if v_qualification_level is null then
      raise exception 'Активная квалификация не найдена: %', p_required_qualification_id;
    end if;
  end if;

  if p_required_equipment_ids is null then
    p_required_equipment_ids := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_required_equipment_ids) <> 'array' then
    raise exception 'required_equipment_ids должен быть JSON array';
  end if;
  for v_equipment_id in
    select value from jsonb_array_elements_text(p_required_equipment_ids)
  loop
    if not exists (select 1 from equipment where id = trim(v_equipment_id) and active) then
      raise exception 'Активное оборудование не найдено: %', v_equipment_id;
    end if;
  end loop;

  if p_sequence <= 0
     or p_workers_required <= 0
     or p_setup_norm_hours < 0
     or p_labor_norm_hours_per_unit < 0
     or (p_setup_norm_hours = 0 and p_labor_norm_hours_per_unit = 0)
  then
    raise exception 'Некорректная норма нормализованной операции';
  end if;

  insert into route_operations(
    id, product_id, sequence, code, name, work_center,
    required_qualification, required_equipment_ids, setup_minutes,
    run_minutes_per_unit, active, labor_norm_hours_per_unit,
    setup_norm_hours, workers_required, route_id, work_center_id,
    required_qualification_id
  ) values (
    trim(p_id), v_product_id, p_sequence, trim(p_code), trim(p_name),
    v_work_center, v_qualification_level, p_required_equipment_ids,
    ceil(p_setup_norm_hours * 60)::integer,
    round(p_labor_norm_hours_per_unit * 60, 6), coalesce(p_active, true),
    p_labor_norm_hours_per_unit, p_setup_norm_hours, p_workers_required,
    trim(p_route_id), trim(p_work_center_id), trim(p_required_qualification_id)
  )
  on conflict (id) do update set
    product_id = excluded.product_id,
    sequence = excluded.sequence,
    code = excluded.code,
    name = excluded.name,
    work_center = excluded.work_center,
    required_qualification = excluded.required_qualification,
    required_equipment_ids = excluded.required_equipment_ids,
    setup_minutes = excluded.setup_minutes,
    run_minutes_per_unit = excluded.run_minutes_per_unit,
    active = excluded.active,
    labor_norm_hours_per_unit = excluded.labor_norm_hours_per_unit,
    setup_norm_hours = excluded.setup_norm_hours,
    workers_required = excluded.workers_required,
    route_id = excluded.route_id,
    work_center_id = excluded.work_center_id,
    required_qualification_id = excluded.required_qualification_id;

  insert into audit_log(actor_id, entity_type, entity_id, action, after_state)
  values (
    auth.uid()::text,
    'MES_ROUTE_OPERATION',
    trim(p_id),
    'MASTER_DATA_SAVE_V2',
    jsonb_build_object(
      'route_id', p_route_id,
      'product_id', v_product_id,
      'work_center_id', p_work_center_id,
      'required_qualification_id', p_required_qualification_id,
      'sequence', p_sequence,
      'labor_norm_hours_per_unit', p_labor_norm_hours_per_unit,
      'setup_norm_hours', p_setup_norm_hours,
      'workers_required', p_workers_required
    )
  );

  select * into r from route_operations where id = trim(p_id);
  return to_jsonb(r);
end;
$$;

grantedummy;
