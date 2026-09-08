-- Database-side transition guard used by execution RPCs.
-- The UI and TypeScript lifecycle remain the source of interaction semantics;
-- this helper mirrors the immutable status graph needed at the database boundary.

create or replace function can_transition_status(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case
    when p_from = 'DRAFT' and p_to = 'PLANNED' then true
    when p_from = 'PLANNED' and p_to = 'ASSIGNED' then true
    when p_from = 'ASSIGNED' and p_to = 'READY' then true
    when p_from = 'READY' and p_to = 'RUNNING' then true
    when p_from = 'RUNNING' and p_to = 'PAUSED' then true
    when p_from = 'RUNNING' and p_to = 'PARTIALLY_COMPLETED' then true
    when p_from = 'RUNNING' and p_to = 'COMPLETED' then true
    when p_from = 'PAUSED' and p_to = 'RUNNING' then true
    when p_from = 'PAUSED' and p_to = 'BLOCKED' then true
    when p_from = 'BLOCKED' and p_to = 'READY' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'RUNNING' then true
    when p_from = 'PARTIALLY_COMPLETED' and p_to = 'COMPLETED' then true
    else false
  end
$$;
