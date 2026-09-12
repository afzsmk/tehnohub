select no_plan();

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mes_master_save_shift'
      and pg_get_function_identity_arguments(p.oid) = 'p_id text, p_name text, p_start_minute integer, p_duration_minutes integer, p_active boolean'
  ),
  'controlled shift master-data RPC exists with bootstrap import contract'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mes_master_save_shift'
      and not has_function_privilege('anon', p.oid, 'execute') = false
  ),
  'shift master-data RPC is not executable by anon'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mes_import_bootstrap'
      and position('mes_master_save_shift' in lower(pg_get_functiondef(p.oid))) > 0
  ),
  'bootstrap importer calls controlled shift RPC'
);

select * from finish();
