-- Keep internal MES consistency helpers out of the browser RPC surface.
-- They are invoked by database triggers/controlled functions and must not be
-- directly executable by authenticated PostgREST clients.

revoke execute on function public.mes_sync_order_from_task(text) from authenticated;
revoke execute on function public.mes_sync_order_after_task_change() from authenticated;
revoke execute on function public.mes_sync_order_from_task(text) from anon;
revoke execute on function public.mes_sync_order_after_task_change() from anon;
revoke execute on function public.mes_sync_order_from_task(text) from public;
revoke execute on function public.mes_sync_order_after_task_change() from public;

comment on function public.mes_sync_order_from_task(text) is
'Internal MES consistency helper. Invoked by task lifecycle triggers; not a browser RPC.';

comment on function public.mes_sync_order_after_task_change() is
'Internal MES trigger function. Not a browser RPC.';
