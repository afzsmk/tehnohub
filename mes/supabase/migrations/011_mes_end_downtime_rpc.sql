-- Close an open downtime through a SECURITY DEFINER RPC.
-- The browser supplies only the downtime id/time; actor identity comes from auth.uid().

create or replace function mes_end_downtime(
  p_downtime_id text,
  p_ended_at timestamptz default now()
)
returns downtime_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event downtime_events%rowtype;
  v_employee_id text;
begin
  select * into v_event
    from downtime_events
   where id = p_downtime_id
   for update;

  if not found then
    raise exception 'Простой не найден: %', p_downtime_id;
  end if;

  if v_event.ended_at is not null then
    raise exception 'Простой уже закрыт';
  end if;

  if p_ended_at < v_event.started_at then
    raise exception 'Время окончания простоя раньше времени начала';
  end if;

  v_employee_id := mes_current_employee_id();

  update downtime_events
     set ended_at = p_ended_at
   where id = p_downtime_id
   returning * into v_event;

  insert into production_events(id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    'DOWNTIME_ENDED',
    p_ended_at,
    auth.uid()::text,
    jsonb_build_object(
      'downtimeId', v_event.id,
      'equipmentId', v_event.equipment_id,
      'employeeId', v_employee_id,
      'role', mes_current_role()
    )
  );

  return v_event;
end;
$$;

grant execute on function mes_end_downtime(text,timestamptz) to authenticated;
