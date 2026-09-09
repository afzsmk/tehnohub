-- MES task/route integrity: every production task must reference an existing
-- technological operation belonging to the order's product and sequence.

create index if not exists idx_tasks_operation on production_tasks(operation_id);

create or replace function mes_assert_task_route_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_product_id text;
  route_product_id text;
  route_sequence integer;
begin
  select product_id
    into order_product_id
    from production_orders
   where id = new.order_id;

  if order_product_id is null then
    raise exception 'MES: production task references unknown order %', new.order_id;
  end if;

  select product_id, sequence
    into route_product_id, route_sequence
    from route_operations
   where id = new.operation_id;

  if route_product_id is null then
    raise exception 'MES: production task references unknown route operation %', new.operation_id;
  end if;

  if route_product_id <> order_product_id then
    raise exception 'MES: route operation % belongs to product %, but order % belongs to product %',
      new.operation_id, route_product_id, new.order_id, order_product_id;
  end if;

  if route_sequence <> new.operation_sequence then
    raise exception 'MES: task % sequence % does not match route operation % sequence %',
      new.id, new.operation_sequence, new.operation_id, route_sequence;
  end if;

  return new;
end;
$$;

drop trigger if exists mes_task_route_integrity on production_tasks;
create trigger mes_task_route_integrity
before insert or update of order_id, operation_id, operation_sequence
on production_tasks
for each row execute function mes_assert_task_route_integrity();

create or replace function mes_assert_route_operation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from production_tasks task
      join production_orders ord on ord.id = task.order_id
     where task.operation_id = new.id
       and (ord.product_id <> new.product_id or task.operation_sequence <> new.sequence)
  ) then
    raise exception 'MES: route operation % change would invalidate existing production tasks', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists mes_route_operation_change_integrity on route_operations;
create trigger mes_route_operation_change_integrity
before update of product_id, sequence
on route_operations
for each row execute function mes_assert_route_operation_change();

-- A route operation with production history is retained as master-data history;
-- deactivation is preferred over physical deletion.
create or replace function mes_delete_route_operation(p_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed route_operations;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER']) then
    raise exception 'Недостаточно прав для удаления технологического маршрута';
  end if;
  if exists (select 1 from production_tasks where operation_id = p_id) then
    raise exception 'Нельзя удалить технологическую операцию %, пока существуют производственные задания; деактивируйте операцию', p_id;
  end if;

  delete from route_operations where id = p_id returning * into removed;
  if removed.id is null then raise exception 'Операция маршрута не найдена'; end if;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (auth.uid()::text, 'MES_ROUTE_OPERATION', removed.id, 'ROUTE_OPERATION_DELETED', to_jsonb(removed), null);
end;
$$;

grant execute on function mes_delete_route_operation(text) to authenticated;

-- Diagnostics for operators/DBA. The function is read-only and returns all
-- currently inconsistent tasks so migration or pre-existing data can be audited.
create or replace function mes_find_task_route_integrity_violations()
returns table (
  task_id text,
  order_id text,
  operation_id text,
  operation_sequence integer,
  issue text
)
language sql
security invoker
stable
as $$
  select
    task.id,
    task.order_id,
    task.operation_id,
    task.operation_sequence,
    case
      when ord.id is null then 'UNKNOWN_ORDER'
      when route.id is null then 'UNKNOWN_ROUTE_OPERATION'
      when ord.product_id <> route.product_id then 'ROUTE_PRODUCT_MISMATCH'
      when task.operation_sequence <> route.sequence then 'ROUTE_SEQUENCE_MISMATCH'
      else 'OK'
    end
  from production_tasks task
  left join production_orders ord on ord.id = task.order_id
  left join route_operations route on route.id = task.operation_id
  where ord.id is null
     or route.id is null
     or ord.product_id <> route.product_id
     or task.operation_sequence <> route.sequence;
$$;

grant execute on function mes_find_task_route_integrity_violations() to authenticated;
