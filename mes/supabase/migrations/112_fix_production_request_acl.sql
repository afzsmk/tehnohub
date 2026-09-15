-- Production requests use a SECURITY DEFINER browser-facing RPC.
-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default;
-- explicitly remove anonymous execution while retaining authenticated access.
revoke execute on function public.mes_create_production_request(text,text,text,date,jsonb) from public, anon;
grant execute on function public.mes_create_production_request(text,text,text,date,jsonb) to authenticated;
