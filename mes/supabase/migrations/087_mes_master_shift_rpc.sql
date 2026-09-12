-- Controlled shift master-data API used by the bootstrap importer and MES master UI.
-- Keep the existing five-argument import contract explicit.

create or replace function mes_master_save_shift(
  p_id text,
  p_name text,
  p_start_minute integer,
  p_duration_minutes integer,
  p_active boolean
)
returns shift_definitions
language plpgsql
security definer
set search_path=public
as $$
declare
  v shift_definitions%rowtype;
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null
     or nullif(trim(p_name),'') is null then
    raise exception 'Для смены обязательны id и name';
  end if;

  if p_start_minute < 0 or p_start_minute >= 1440 then
    raise exception 'start_minute должен быть в диапазоне 0..1439';
  end if;

  if p_duration_minutes <= 0 or p_duration_minutes > 1440 then
    raise exception 'duration_minutes должен быть в диапазоне 1..1440';
  end if;

  insert into shift_definitions(id,name,start_minute,duration_minutes,active)
  values(
    trim(p_id),
    trim(p_name),
    p_start_minute,
    p_duration_minutes,
    coalesce(p_active,true)
  )
  on conflict(id) do update set
    name=excluded.name,
    start_minute=excluded.start_minute,
    duration_minutes=excluded.duration_minutes,
    active=excluded.active
  returning * into v;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(
    auth.uid()::text,
    'SHIFT_DEFINITION',
    v.id,
    'MASTER_DATA_SAVE',
    to_jsonb(v)
  );

  return v;
end;
$$;

revoke execute on function mes_master_save_shift(text,text,integer,integer,boolean) from public, anon;
grant execute on function mes_master_save_shift(text,text,integer,integer,boolean) to authenticated;

comment on function mes_master_save_shift(text,text,integer,integer,boolean) is
'Controlled MES shift master-data write API. Direct browser DML remains forbidden.';
