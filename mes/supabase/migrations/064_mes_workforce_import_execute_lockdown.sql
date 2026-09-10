-- Workforce -> MES plan import is server-to-server only.
-- The Edge Function authenticates the caller with the integration secret,
-- then executes this SECURITY DEFINER RPC with the service_role.
revoke execute on function public.mes_import_workforce_plan(jsonb, text) from public;
revoke execute on function public.mes_import_workforce_plan(jsonb, text) from anon, authenticated;
grant execute on function public.mes_import_workforce_plan(jsonb, text) to service_role;
