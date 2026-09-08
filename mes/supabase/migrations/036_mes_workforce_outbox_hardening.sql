-- MES -> Workforce outbox hardening.
-- Outbox delivery is infrastructure state, while production history remains immutable.

alter table integration_outbox
  drop constraint if exists integration_outbox_idempotency_payload_check;

alter table integration_outbox
  add constraint integration_outbox_idempotency_payload_check
  check (coalesce(event_payload->>'idempotencyKey', '') = idempotency_key);

create or replace function mes_assert_outbox_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return;
  end if;
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','ANALYST']) then
    raise exception 'Недостаточно прав для работы с интеграционным outbox';
  end if;
end;
$$;

create or replace function mes_claim_actual_feedback_outbox(
  p_limit integer default 50,
  p_stale_after interval default interval '15 minutes'
)
returns setof integration_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  perform mes_assert_outbox_worker();

  if p_stale_after <= interval '0 seconds' then
    raise exception 'p_stale_after должен быть положительным';
  end if;

  return query
  with candidates as (
    select id
      from integration_outbox
     where status in ('PENDING','FAILED')
        or (status = 'SENDING' and last_attempt_at is not null and last_attempt_at <= now() - p_stale_after)
     order by created_at, id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  )
  update integration_outbox o
     set status = 'SENDING',
         attempts = o.attempts + 1,
         last_attempt_at = now()
    from candidates c
   where o.id = c.id
  returning o.*;
end;
$$;

grant execute on function mes_claim_actual_feedback_outbox(integer, interval) to authenticated;

create or replace function mes_mark_actual_feedback_outbox_sent(
  p_id uuid,
  p_sent_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform mes_assert_outbox_worker();

  update integration_outbox
     set status = 'SENT',
         sent_at = p_sent_at,
         last_error = null
   where id = p_id
     and status = 'SENDING';

  if not found then
    raise exception 'Outbox entry не найдена или не находится в SENDING: %', p_id;
  end if;
end;
$$;

grant execute on function mes_mark_actual_feedback_outbox_sent(uuid,timestamptz) to authenticated;

create or replace function mes_mark_actual_feedback_outbox_failed(
  p_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform mes_assert_outbox_worker();

  update integration_outbox
     set status = 'FAILED',
         last_error = left(coalesce(p_error, 'Неизвестная ошибка'), 4000)
   where id = p_id
     and status = 'SENDING';

  if not found then
    raise exception 'Outbox entry не найдена или не находится в SENDING: %', p_id;
  end if;
end;
$$;

grant execute on function mes_mark_actual_feedback_outbox_failed(uuid,text) to authenticated;

comment on function mes_assert_outbox_worker() is
'Allows Workforce outbox delivery only to authorized MES integration workers or Supabase service_role.';
