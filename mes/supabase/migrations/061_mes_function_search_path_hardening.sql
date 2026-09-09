-- Pin the search_path of public MES helper/trigger functions as an explicit
-- database-level security invariant. SECURITY DEFINER MES functions are already
-- hardened separately; this also quiets the database advisor for invoker helpers.

alter function public.prevent_append_only_mutation() set search_path = public;
alter function public.mes_current_role() set search_path = public;
alter function public.mes_has_role(text[]) set search_path = public;
alter function public.mes_current_employee_id() set search_path = public;
alter function public.mes_actor_matches_employee(text) set search_path = public;
alter function public.mes_current_user_id() set search_path = public;
alter function public.can_transition_status(text,text) set search_path = public;
alter function public.mes_find_task_route_integrity_violations() set search_path = public;
alter function public.mes_assert_production_order_integrity() set search_path = public;
alter function public.mes_assert_production_task_integrity() set search_path = public;
