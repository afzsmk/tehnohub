-- Persistent MES technological routes. Routes are MES master data and are independent from Workforce scheduling.

create table if not exists route_operations (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  code text not null,
  name text not null,
  work_center text not null,
  required_qualification integer check (required_qualification is null or required_qualification >= 0),
  required_equipment_ids jsonb not null default '[]'::jsonb,
  setup_minutes integer not null default 0 check (setup_minutes >= 0),
  run_minutes_per_unit numeric(18,6) not null check (run_minutes_per_unit >= 0),
  active boolean not null default true,
  unique (product_id, sequence)
);

create index if not exists idx_route_operations_product on route_operations(product_id, sequence);

alter table route_operations enable row level security;

drop policy if exists mes_read_route_operations on route_operations;
create policy mes_read_route_operations on route_operations
for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_manage_route_operations on route_operations;
create policy mes_manage_route_operations on route_operations
for all to authenticated
using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']))
with check (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']));

create or replace function mes_save_route_operation(
  p_id text,
  p_product_id text,
  p_sequence integer,
  p_code text,
  p_name text,
  p_work_center text,
  p_required_qualification integer,
  p_required_equipment_ids jsonb,
  p_setup_minutes integer,
  p_run_minutes_per_unit numeric,
  p_active boolean
)
returns route_operations
language plpgsql
security definer
set search_path = public
as $$
declare
  result route_operations;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']) then
    raise exception 'Недостаточно прав для изменения технологического маршрута';
  end if;
  if coalesce(trim(p_id), '') = '' then raise exception 'Идентификатор операции обязателен'; end if;
  if coalesce(trim(p_product_id), '') = '' then raise exception 'Продукт операции обязателен'; end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'Код и наименование операции обязательны'; end if;
  if coalesce(trim(p_work_center), '') = '' then raise exception 'Производственный участок обязателен'; end if;

  insert into route_operations (
    id, product_id, sequence, code, name, work_center,
    required_qualification, required_equipment_ids, setup_minutes,
    run_minutes_per_unit, active
  ) values (
    trim(p_id), trim(p_product_id), p_sequence, trim(p_code), trim(p_name), trim(p_work_center),
    p_required_qualification, coalesce(p_required_equipment_ids, '[]'::jsonb), p_setup_minutes,
    p_run_minutes_per_unit, coalesce(p_active, true)
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
    active = excluded.active
  returning * into result;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'MES_ROUTE_OPERATION',
    result.id,
    'ROUTE_OPERATION_SAVED',
    null,
    to_jsonb(result)
  );

  return result;
end;
$$;

grant execute on function mes_save_route_operation(text,text,integer,text,text,text,integer,jsonb,integer,numeric,boolean) to authenticated;

create or replace function mes_delete_route_operation(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  removed route_operations;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']) then
    raise exception 'Недостаточно прав для удаления технологического маршрута';
  end if;

  delete from route_operations where id = p_id returning * into removed;
  if removed.id is null then raise exception 'Операция маршрута не найдена'; end if;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (auth.uid()::text, 'MES_ROUTE_OPERATION', removed.id, 'ROUTE_OPERATION_DELETED', to_jsonb(removed), null);
end;
$$;

grant execute on function mes_delete_route_operation(text) to authenticated;
