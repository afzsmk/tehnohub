select no_plan();

-- The master bootstrap importer must retain a FAILED run record while keeping
-- the master-data write phase atomic through a nested exception block.
select ok(
  position('exception when others' in lower(pg_get_functiondef(p.oid))) > 0,
  'master bootstrap importer has a nested runtime exception handler'
)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid) = 'p_source_name text, p_payload jsonb';

select ok(
  position('status=''failed''' in lower(pg_get_functiondef(p.oid))) > 0,
  'master bootstrap importer persists FAILED status'
)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid) = 'p_source_name text, p_payload jsonb';

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mes_master_save_product'
      and pg_get_function_identity_arguments(p.oid) = 'p_id text, p_code text, p_name text, p_unit text, p_external_id text'
  ),
  'controlled product master-data RPC exists with external_id contract'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mes_master_save_equipment'
      and pg_get_function_identity_arguments(p.oid) = 'p_id text, p_code text, p_name text, p_work_center text, p_capabilities jsonb, p_active boolean'
  ),
  'controlled equipment master-data RPC exists with bootstrap contract'
);

select ok(
  not has_function_privilege('anon', p.oid, 'execute'),
  'master bootstrap importer is not executable by anon'
)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid) = 'p_source_name text, p_payload jsonb';

select ok(
  to_regclass('public.mes_master_import_runs') is not null,
  'master import run history table exists'
);

select ok(
  has_table_privilege('authenticated','public.mes_master_import_runs','select'),
  'authenticated users may read master import history'
);

select ok(
  not has_table_privilege('authenticated','public.mes_master_import_runs','insert'),
  'authenticated users may not insert master import history directly'
);

select ok(
  not has_table_privilege('authenticated','public.mes_master_import_runs','update'),
  'authenticated users may not update master import history directly'
);

select ok(
  not has_table_privilege('authenticated','public.mes_master_import_runs','delete'),
  'authenticated users may not delete master import history directly'
);

select * from finish();
