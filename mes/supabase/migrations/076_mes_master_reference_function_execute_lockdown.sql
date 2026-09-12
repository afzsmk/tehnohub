-- Master-data SECURITY DEFINER RPCs are browser-facing for authenticated MES master editors,
-- but must never be executable by anon/public.
--
-- Use catalog-driven revocation instead of hard-coding signatures. This keeps the
-- security boundary correct when an RPC's parameter signature evolves.

do $$
declare
  r record;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        p.proname in ('mes_validate_bootstrap', 'mes_import_bootstrap')
        or p.proname like 'mes_master_save_%'
      )
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
  end loop;
end $$;
