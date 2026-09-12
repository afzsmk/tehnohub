-- Controlled product master-data API used by the bootstrap importer and MES master UI.
-- products originated without external_id; add the stable integration reference here
-- while preserving the existing code/name/unit model.

alter table products
  add column if not exists external_id text;

create unique index if not exists uq_products_external_id
  on products(external_id)
  where external_id is not null;

create or replace function mes_master_save_product(
  p_id text,
  p_code text,
  p_name text,
  p_unit text,
  p_external_id text
)
returns products
language plpgsql
security definer
set search_path=public
as $$
declare
  v products%rowtype;
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null
     or nullif(trim(p_code),'') is null
     or nullif(trim(p_name),'') is null
     or nullif(trim(p_unit),'') is null then
    raise exception 'Для продукта обязательны id, code, name и unit';
  end if;

  insert into products(id,code,name,unit,external_id)
  values(
    trim(p_id),
    trim(p_code),
    trim(p_name),
    trim(p_unit),
    nullif(trim(p_external_id),'')
  )
  on conflict(id) do update set
    code=excluded.code,
    name=excluded.name,
    unit=excluded.unit,
    external_id=excluded.external_id
  returning * into v;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(
    auth.uid()::text,
    'PRODUCT',
    v.id,
    'MASTER_DATA_SAVE',
    to_jsonb(v)
  );

  return v;
end;
$$;

revoke execute on function mes_master_save_product(text,text,text,text,text) from public, anon;
grant execute on function mes_master_save_product(text,text,text,text,text) to authenticated;

comment on function mes_master_save_product(text,text,text,text,text) is
'Controlled MES product master-data write API. Direct browser DML remains forbidden.';
