-- Restore the legacy route-operation write contract consumed by the bootstrap importer.
-- The dedicated v2 RPC remains the preferred topology-aware API.

create or replace function mes_master_save_route_operation(
  p_id text,
  p_product_id text,
  p_sequence integer,
  p_code text,
  p_name text,
  p_work_center text,
  p_required_qualification integer,
  p_required_equipment_ids jsonb,
  p_setup_norm_hours numeric,
  p_labor_norm_hours_per_unit numeric,
  p_workers_required integer,
  p_active boolean
)
returns route_operations
language plpgsql
security definer
set search_path=public
as $$
declare
  v route_operations%rowtype;
  v_equipment_id text;
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null
     or nullif(trim(p_product_id),'') is null
     or nullif(trim(p_code),'') is null
     or nullif(trim(p_name),'') is null
     or nullif(trim(p_work_center),'') is null then
    raise exception 'Для операции обязательны id, product_id, code, name и work_center';
  end if;

  if not exists (select 1 from products where id=trim(p_product_id)) then
    raise exception 'Продукт % не существует', p_product_id;
  end if;

  if p_sequence <= 0
     or coalesce(p_required_qualification,0) < 0
     or coalesce(p_workers_required,1) <= 0
     or coalesce(p_setup_norm_hours,0) < 0
     or coalesce(p_labor_norm_hours_per_unit,0) < 0
     or (coalesce(p_setup_norm_hours,0)=0 and coalesce(p_labor_norm_hours_per_unit,0)=0) then
    raise exception 'Некорректная норма или параметры route operation';
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
    if not exists (select 1 from equipment where id=trim(v_equipment_id)) then
      raise exception 'Оборудование % не существует', v_equipment_id;
    end if;
  end loop;

  insert into route_operations(
    id, product_id, sequence, code, name, work_center,
    required_qualification, required_equipment_ids,
    setup_minutes, run_minutes_per_unit, active,
    labor_norm_hours_per_unit, setup_norm_hours, workers_required
  ) values (
    trim(p_id), trim(p_product_id), p_sequence, trim(p_code), trim(p_name),
    trim(p_work_center), coalesce(p_required_qualification,0),
    p_required_equipment_ids,
    ceil(coalesce(p_setup_norm_hours,0) * 60)::integer,
    round(coalesce(p_labor_norm_hours_per_unit,0) * 60,6),
    coalesce(p_active,true),
    coalesce(p_labor_norm_hours_per_unit,0),
    coalesce(p_setup_norm_hours,0),
    coalesce(p_workers_required,1)
  )
  on conflict(id) do update set
    product_id=excluded.product_id,
    sequence=excluded.sequence,
    code=excluded.code,
    name=excluded.name,
    work_center=excluded.work_center,
    required_qualification=excluded.required_qualification,
    required_equipment_ids=excluded.required_equipment_ids,
    setup_minutes=excluded.setup_minutes,
    run_minutes_per_unit=excluded.run_minutes_per_unit,
    active=excluded.active,
    labor_norm_hours_per_unit=excluded.labor_norm_hours_per_unit,
    setup_norm_hours=excluded.setup_norm_hours,
    workers_required=excluded.workers_required
  returning * into v;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(auth.uid()::text,'MES_ROUTE_OPERATION',v.id,'MASTER_DATA_SAVE',to_jsonb(v));

  return v;
end;
$$;

revoke execute on function mes_master_save_route_operation(text,text,integer,text,text,text,integer,jsonb,numeric,numeric,integer,boolean) from public, anon;
grant execute on function mes_master_save_route_operation(text,text,integer,text,text,text,integer,jsonb,numeric,numeric,integer,boolean) to authenticated;

comment on function mes_master_save_route_operation(text,text,integer,text,text,text,integer,jsonb,numeric,numeric,integer,boolean) is
'Compatibility MES route-operation write API. Prefer mes_master_save_route_operation_v2 for normalized topology-aware writes.';
