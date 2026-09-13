-- Keep task-linked production history monotonic by occurred_at.
-- This closes the remaining chronology gap for result and quality events and
-- protects the invariant even when another server-side path appends an event.

create or replace function guard_production_event_chronology()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_event_at timestamptz;
begin
  if new.task_id is null then
    return new;
  end if;

  select max(e.occurred_at)
    into v_last_event_at
    from production_events e
   where e.task_id = new.task_id;

  if v_last_event_at is not null and new.occurred_at < v_last_event_at then
    raise exception 'Время события раньше последнего события задания';
  end if;

  return new;
end;
$$;

drop trigger if exists production_events_chronology_guard on production_events;
create trigger production_events_chronology_guard
before insert on production_events
for each row
execute function guard_production_event_chronology();

revoke all on function guard_production_event_chronology() from public, anon, authenticated;
