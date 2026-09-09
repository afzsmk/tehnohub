-- Internal diagnostics and outbox worker primitives are not browser RPCs.
-- Keep them callable by trusted database execution only.

revoke execute on function public.mes_assert_order_route_completeness(text,text) from authenticated, anon, public;
revoke execute on function public.mes_assert_outbox_worker() from authenticated, anon, public;
revoke execute on function public.mes_assert_replan_employee_calendar(text,timestamptz,timestamptz) from authenticated, anon, public;
revoke execute on function public.mes_assert_route_operation_change() from authenticated, anon, public;
revoke execute on function public.mes_assert_task_employee_calendar(text) from authenticated, anon, public;
revoke execute on function public.mes_assert_task_route_integrity() from authenticated, anon, public;
revoke execute on function public.mes_check_operational_integrity() from authenticated, anon, public;
revoke execute on function public.mes_claim_actual_feedback_outbox(integer) from authenticated, anon, public;
revoke execute on function public.mes_claim_actual_feedback_outbox(integer,interval) from authenticated, anon, public;
revoke execute on function public.mes_enqueue_actual_feedback(jsonb) from authenticated, anon, public;
revoke execute on function public.mes_enqueue_workforce_event_from_production_event() from authenticated, anon, public;
revoke execute on function public.mes_mark_actual_feedback_outbox_failed(uuid,text) from authenticated, anon, public;
revoke execute on function public.mes_mark_actual_feedback_outbox_sent(uuid,timestamptz) from authenticated, anon, public;
revoke execute on function public.mes_validate_order_status_integrity() from authenticated, anon, public;
revoke execute on function public.mes_validate_ready_employee_calendar() from authenticated, anon, public;
