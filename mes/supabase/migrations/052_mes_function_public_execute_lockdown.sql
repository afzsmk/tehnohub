-- SECURITY DEFINER MES RPCs must never be callable through the implicit PUBLIC grant.
-- Existing migrations explicitly grant EXECUTE to authenticated where a function is
-- intended for browser/API use. Internal trigger helpers remain callable by the
-- database without needing an EXECUTE grant.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid,
           n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as identity_arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'mes_%'
       and p.prosecdef
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public',
      fn.schema_name,
      fn.function_name,
      fn.identity_arguments
    );
  end loop;
end;
$$;

comment on schema public is 'MES SECURITY DEFINER functions are not executable by PUBLIC; browser-facing RPCs must explicitly grant authenticated access.';
