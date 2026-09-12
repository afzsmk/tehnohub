-- Controlled equipment master-data API used by the bootstrap importer and MES master UI.
-- Keep the legacy six-argument contract explicit: work center text,
-- capability JSONB and active flag are part of the existing importer payload.

create or replace function mes_master_save_equipment(
  p_id text,
  p_code text,
  p_name text,
  p_work_center text,
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
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null
     or nullif(trim(p_code),'') is null
     or nullif(trim(p_name),'') is null
     or nullif(trim(p_work_center),'') is null then
    raise exception 'Для оборудования обязательны id, code, name и work_center';
  end if;

  insert into equipment(id,code,name,work_center,capabilities,active)
  values(
    trim(p_id),
    trim(p_code),
    trim(p_name),
    trim(p_work_center),
    coalesce(p_capabilities,'[]'::jsonb),
    coalesce(p_active,true)
  )
  on conflict(id) do update set
    code=excluded.code,
    name=excluded.name,
    work_center=excluded.work_center,
    capabilities=excluded.capabilities,
    active=excluded.active
  returning * into v;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(
    auth.uid()::text,
    'EQUIPMENT',
    v.id,
    'MASTER_DATA_SAVE',
    to_jsonb(v)
  );

  return v;
end;
$$;

revoke execute on function mes_master_save_equipment(text,text,text,text,jsonb,boolean) from public, anon;
grant execute on function mes_master_save_equipment(text,text,text,text,jsonb,boolean) to authenticated;

comment on function mes_master_save_equipment(text,text,text,text,jsonb,boolean) is
'Controlled MES equipment master-data write API. Direct browser DML remains forbidden.';
