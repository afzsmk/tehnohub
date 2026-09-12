select no_plan();

-- Normalized topology is the native path for bootstrap imports.
select ok(position('mes_master_save_equipment_v2' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer uses normalized equipment RPC')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select ok(position('mes_master_save_route_operation_v2' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer uses normalized route-operation RPC')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='mes_master_save_equipment_v2'
      and pg_get_function_identity_arguments(p.oid)='p_id text, p_code text, p_name text, p_work_center_id text, p_capabilities jsonb, p_active boolean'
  ),
  'normalized equipment RPC has stable work_center_id contract'
);

select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='mes_master_save_route_operation_v2'
      and pg_get_function_identity_arguments(p.oid)='p_id text, p_route_id text, p_sequence integer, p_code text, p_name text, p_work_center_id text, p_required_qualification_id text, p_required_equipment_ids jsonb, p_setup_norm_hours numeric, p_labor_norm_hours_per_unit numeric, p_workers_required integer, p_active boolean'
  ),
  'normalized route-operation RPC has stable topology contract'
);

select ok(position('v_wc' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer resolves work-center references')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select ok(position('v_qual' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer resolves qualification references')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select * from finish();
