-- Normalize equipment master writes around the work-center entity.
-- Legacy mes_master_save_equipment remains available for compatibility.

create or replace function mes_master_save_equipment_v2(
  p_id text,
  p_code text,
  p_name text,
  p_work_center_id text,
  p_capabilities jsonb,
  p_active boolean
)
returns equipment
language plpgsql
security definer
set search_path=public
as $$
declare
  v equipment%rowtype;
  v_work_center_name text;
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null
     or nullif(trim(p_code),'') is null
     or nullif(trim(p_name),'') is null
     or nullif(trim(p_work_center_id),'') is null then
    raise exception 'Для оборудования обязательны id, code, name и work_center_id';
  end if;

  select name into v_work_center_name
  from work_centers
  where id = trim(p_work_center_id)
    and active = true;

  if v_work_center_name is null then
    raise exception 'Активный рабочий центр не найден: %', p_work_center_id;
  end if;

  if p_capabilities is null then
    p_capabilities := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_capabilities) <> 'array' then
    raise exception 'capabilities должен быть JSON array';
  end if;

  insert into equipment(id,code,name,work_center,capabilities,active,work_center_id)
  values(
    trim(p_id),
    trim(p_code),
    trim(p_name),
    v_work_center_name,
    p_capabilities,
    coalesce(p_active,true),
    trim(p_work_center_id)
  )
  on conflict(id) do update set
    code=excluded.code,
    name=excluded.name,
    work_center=excluded.work_center,
    capabilities=excluded.capabilities,
    active=excluded.active,
    work_center_id=excluded.work_center_id
  returning * into v;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(
    auth.uid()::text,
    'EQUIPMENT',
    v.id,
    'MASTER_DATA_SAVE_V2',
    to_jsonb(v)
  );

  return v;
end;
$$;

revoke execute on function mes_master_save_equipment_v2(text,text,text,text,jsonb,boolean) from public, anon;
grant execute on function mes_master_save_equipment_v2(text,text,text,text,jsonb,boolean) to authenticated;

comment on function mes_master_save_equipment_v2(text,text,text,text,jsonb,boolean) is
'Normalized MES equipment master-data write API bound to work_center_id.';
