-- Normalize the security boundary for every existing MES SECURITY DEFINER function.
-- Individual function migrations should keep SET search_path = public as well;
-- this migration is the final schema-level backstop for legacy functions.

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
      'alter function public.%s set search_path = public',
      function_signature
    );
  end loop;
end
$$;
