-- Normalize operational work centers and route headers while preserving existing
-- denormalized columns for backwards compatibility during the v1.1 rollout.

create table if not exists work_centers (
  id text primary key,
  external_id text unique,
  code text not null unique,
  name text not null,
  site_code text,
  description text,
  active boolean not null default true
);

create table if not exists routes (
  id text primary key,
  external_id text unique,
  product_id text not null references products(id),
  code text not null,
  name text not null,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  valid_from date,
  valid_to date,
  description text,
  unique(product_id, code, version),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

alter table equipment add column if not exists work_center_id text references work_centers(id);
alter table route_operations add column if not exists route_id text references routes(id);
alter table route_operations add column if not exists work_center_id text references work_centers(id);

create unique index if not exists uq_route_operations_route_sequence
  on route_operations(route_id, sequence)
  where route_id is not null;
create index if not exists idx_routes_product on routes(product_id);
create index if not exists idx_routes_active on routes(active);
create index if not exists idx_work_centers_active on work_centers(active);
create index if not exists idx_equipment_work_center_id on equipment(work_center_id);
create index if not exists idx_route_operations_route_id on route_operations(route_id);
create index if not exists idx_route_operations_work_center_id on route_operations(work_center_id);

alter table work_centers enable row level security;
alter table routes enable row level security;

drop policy if exists work_centers_select_authenticated on work_centers;
create policy work_centers_select_authenticated on work_centers for select to authenticated using (true);
drop policy if exists routes_select_authenticated on routes;
create policy routes_select_authenticated on routes for select to authenticated using (true);

revoke insert, update, delete on work_centers from authenticated;
revoke insert, update, delete on routes from authenticated;

create or replace function mes_master_save_work_center(
  p_id text,
  p_external_id text,
  p_code text,
  p_name text,
  p_site_code text,
  p_description text,
  p_active boolean
)
returns work_centers
language plpgsql
security definer
set search_path=public
as $$
declare v work_centers%rowtype;
begin
  perform mes_require_master_editor();
  insert into work_centers(id,external_id,code,name,site_code,description,active)
  values(trim(p_id),nullif(trim(p_external_id),''),trim(p_code),trim(p_name),nullif(trim(p_site_code),''),nullif(trim(p_description),''),coalesce(p_active,true))
  on conflict(id) do update set
    external_id=excluded.external_id,
    code=excluded.code,
    name=excluded.name,
    site_code=excluded.site_code,
    description=excluded.description,
    active=excluded.active
  returning * into v;
  return v;
end;
$$;

grant execute on function mes_master_save_work_center(text,text,text,text,text,text,boolean) to authenticated;

create or replace function mes_master_save_route(
  p_id text,
  p_external_id text,
  p_product_id text,
  p_code text,
  p_name text,
  p_version integer,
  p_active boolean,
  p_valid_from date,
  p_valid_to date,
  p_description text
)
returns routes
language plpgsql
security definer
set search_path=public
as $$
declare v routes%rowtype;
begin
  perform mes_require_master_editor();
  if p_version is null or p_version <= 0 then raise exception 'Версия маршрута должна быть > 0'; end if;
  if not exists(select 1 from products where id=trim(p_product_id)) then raise exception 'Продукт % не существует',p_product_id; end if;
  insert into routes(id,external_id,product_id,code,name,version,active,valid_from,valid_to,description)
  values(trim(p_id),nullif(trim(p_external_id),''),trim(p_product_id),trim(p_code),trim(p_name),p_version,coalesce(p_active,true),p_valid_from,p_valid_to,nullif(trim(p_description),''))
  on conflict(id) do update set
    external_id=excluded.external_id,
    product_id=excluded.product_id,
    code=excluded.code,
    name=excluded.name,
    version=excluded.version,
    active=excluded.active,
    valid_from=excluded.valid_from,
    valid_to=excluded.valid_to,
    description=excluded.description
  returning * into v;
  return v;
end;
$$;

grant execute on function mes_master_save_route(text,text,text,text,text,integer,boolean,date,date,text) to authenticated;
