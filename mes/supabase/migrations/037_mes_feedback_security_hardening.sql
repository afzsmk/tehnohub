-- MES Workforce feedback security hardening.
-- The outbound outbox is an internal integration queue, not a client-controlled
-- business table. Only controlled RPCs may mutate delivery state.

revoke all on table integration_outbox from anon;
revoke all on table integration_outbox from authenticated;

revoke execute on function mes_enqueue_actual_feedback(jsonb) from anon;
revoke execute on function mes_claim_actual_feedback_outbox(integer, interval) from anon;
revoke execute on function mes_mark_actual_feedback_outbox_sent(uuid, timestamptz) from anon;
revoke execute on function mes_mark_actual_feedback_outbox_failed(uuid, text) from anon;

grant execute on function mes_enqueue_actual_feedback(jsonb) to authenticated;
grant execute on function mes_claim_actual_feedback_outbox(integer, interval) to authenticated;
grant execute on function mes_mark_actual_feedback_outbox_sent(uuid, timestamptz) to authenticated;
grant execute on function mes_mark_actual_feedback_outbox_failed(uuid, text) to authenticated;

create or replace function mes_mark_actual_feedback_outbox_sent(
  p_id uuid,
  p_sent_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','ANALYST']) then
    raise exception 'Недостаточно прав для подтверждения доставки Workforce';
  end if;

  update integration_outbox
     set status = 'SENT',
         sent_at = coalesce(p_sent_at, now()),
         last_error = null
   where id = p_id
     and status = 'SENDING';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Outbox entry не находится в состоянии SENDING: %', p_id;
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
declare
  v_updated integer;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','ANALYST']) then
    raise exception 'Недостаточно прав для фиксации ошибки доставки Workforce';
  end if;

  update integration_outbox
     set status = 'FAILED',
         last_error = left(coalesce(nullif(trim(p_error), ''), 'Неизвестная ошибка'), 4000)
   where id = p_id
     and status = 'SENDING';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Outbox entry не находится в состоянии SENDING: %', p_id;
  end if;
end;
$$;

grant execute on function mes_mark_actual_feedback_outbox_failed(uuid,text) to authenticated;

comment on function mes_mark_actual_feedback_outbox_sent(uuid,timestamptz) is
'Controlled confirmation of a claimed Workforce outbox item; only SENDING rows can become SENT.';
comment on function mes_mark_actual_feedback_outbox_failed(uuid,text) is
'Controlled failure transition of a claimed Workforce outbox item; only SENDING rows can become FAILED.';
