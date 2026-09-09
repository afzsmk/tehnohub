-- MES -> Workforce actual feedback outbox.
-- Delivery state is kept inside MES; sending never removes production history.

create table if not exists integration_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text
);

create index if not exists idx_integration_outbox_status_created
  on integration_outbox(status, created_at);

create or replace function mes_enqueue_actual_feedback(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event jsonb;
  v_count integer := 0;
  v_key text;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'events должен быть массивом';
  end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    v_key := v_event->>'idempotencyKey';
    if coalesce(trim(v_key), '') = '' then
      raise exception 'Каждое событие должно иметь idempotencyKey';
    end if;

    insert into integration_outbox(idempotency_key, event_payload)
    values (v_key, v_event)
    on conflict (idempotency_key) do nothing;

    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$$;

create or replace function mes_claim_actual_feedback_outbox(p_limit integer default 50)
returns setof integration_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from integration_outbox
    where status in ('PENDING','FAILED')
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 500))
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

create or replace function mes_mark_actual_feedback_outbox_sent(p_id uuid, p_sent_at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update integration_outbox
     set status = 'SENT', sent_at = p_sent_at, last_error = null
   where id = p_id;
  if not found then raise exception 'Outbox entry не найдена: %', p_id; end if;
end;
$$;

create or replace function mes_mark_actual_feedback_outbox_failed(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update integration_outbox
     set status = 'FAILED', last_error = left(coalesce(p_error, 'Неизвестная ошибка'), 4000)
   where id = p_id;
  if not found then raise exception 'Outbox entry не найдена: %', p_id; end if;
end;
$$;

comment on table integration_outbox is
'MES outbound outbox for reliable Workforce actual-feedback delivery; rows are retained after successful delivery for operational traceability.';
