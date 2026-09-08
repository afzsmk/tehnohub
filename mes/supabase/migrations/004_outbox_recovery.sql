-- Recover abandoned SENDING rows after a worker/process crash.
-- The timeout is deliberately explicit so deployments can tune it later without changing the dispatcher contract.

create or replace function mes_claim_actual_feedback_outbox(p_limit integer default 50, p_stale_after interval default interval '15 minutes')
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
       or (status = 'SENDING' and last_attempt_at is not null and last_attempt_at <= now() - p_stale_after)
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

comment on function mes_claim_actual_feedback_outbox(integer, interval) is
'Claims pending/failed outbound actual-feedback and safely reclaims stale SENDING rows after a worker crash.';
