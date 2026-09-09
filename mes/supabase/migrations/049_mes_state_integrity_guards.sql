-- Last-line database guards for production facts.
-- RPCs perform the full workflow validation; these triggers protect the core
-- numeric invariants even when future SECURITY DEFINER functions are introduced.

create or replace function mes_assert_production_order_integrity()
returns trigger
language plpgsql
as $$
begin
  if new.quantity <= 0 then
    raise exception 'Количество заказа должно быть больше нуля';
  end if;
  if new.completed_quantity < 0 then
    raise exception 'Выполненное количество заказа не может быть отрицательным';
  end if;
  if new.completed_quantity > new.quantity then
    raise exception 'Выполненное количество заказа % превышает количество заказа %', new.completed_quantity, new.quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists mes_production_order_integrity on production_orders;
create trigger mes_production_order_integrity
before insert or update of quantity, completed_quantity on production_orders
for each row execute function mes_assert_production_order_integrity();

create or replace function mes_assert_production_task_integrity()
returns trigger
language plpgsql
as $$
begin
  if new.planned_quantity <= 0 then
    raise exception 'Плановое количество операции должно быть больше нуля';
  end if;
  if new.actual_quantity < 0 then
    raise exception 'Фактическое количество операции не может быть отрицательным';
  end if;
  if new.actual_quantity > new.planned_quantity then
    raise exception 'Фактическое количество операции % превышает план %', new.actual_quantity, new.planned_quantity;
  end if;
  if new.actual_start is null and new.actual_end is not null then
    raise exception 'Факт окончания операции требует факта начала';
  end if;
  if new.actual_start is not null and new.actual_end is not null and new.actual_start > new.actual_end then
    raise exception 'Факт начала операции не может быть позже факта окончания';
  end if;
  return new;
end;
$$;

drop trigger if exists mes_production_task_integrity on production_tasks;
create trigger mes_production_task_integrity
before insert or update of planned_quantity, actual_quantity, actual_start, actual_end on production_tasks
for each row execute function mes_assert_production_task_integrity();

comment on function mes_assert_production_order_integrity() is
'Database-level MES guard: production order completion cannot exceed ordered quantity.';

comment on function mes_assert_production_task_integrity() is
'Database-level MES guard: task actual quantity cannot exceed planned quantity and actual timestamps remain ordered.';
