-- Final browser boundary for MES RPCs.
-- SECURITY DEFINER functions must never be executable by anonymous clients.
-- Revoke both PUBLIC and anon explicitly so future default grants cannot reopen
-- anonymous access through the generic PostgREST function endpoint.

do $$
declare
  function_signature text;
begin
  for function_signature in
    select format(
      '%I(%s)',
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname like 'mes_%'
  loop
    execute format(
      'revoke execute on function public.%s from anon',
      function_signature
    );
    execute format(
      'revoke execute on function public.%s from public',
      function_signature
    );
  end loop;
end
$$;
