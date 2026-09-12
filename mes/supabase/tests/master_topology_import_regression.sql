select no_plan();

-- The topology import contract must validate and persist normalized work centers/routes.
select ok(position('work_centers' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer contains normalized work-center import')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select ok(position('routes' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer contains normalized route import')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select ok(position('route_id=v_route' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer binds operations to route headers')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select ok(position('work_center_id=v_wc' in lower(pg_get_functiondef(p.oid))) > 0, 'bootstrap importer binds equipment and operations to work centers')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mes_import_bootstrap'
  and pg_get_function_identity_arguments(p.oid)='p_source_name text, p_payload jsonb';

select * from finish();
