select no_plan();

select ok((select relrowsecurity from pg_class where relname='work_centers' and relnamespace='public'::regnamespace), 'work_centers has RLS enabled');
select ok((select relrowsecurity from pg_class where relname='routes' and relnamespace='public'::regnamespace), 'routes has RLS enabled');

select ok(not has_table_privilege('authenticated','public.work_centers','insert') and not has_table_privilege('authenticated','public.work_centers','update') and not has_table_privilege('authenticated','public.work_centers','delete'), 'authenticated cannot directly write work_centers');
select ok(not has_table_privilege('authenticated','public.routes','insert') and not has_table_privilege('authenticated','public.routes','update') and not has_table_privilege('authenticated','public.routes','delete'), 'authenticated cannot directly write routes');

select ok(not has_function_privilege('anon','public.mes_master_save_work_center(text,text,text,text,text,text,boolean)','execute'), 'work-center RPC is not executable by anon');
select ok(not has_function_privilege('anon','public.mes_master_save_route(text,text,text,text,text,integer,boolean,date,date,text)','execute'), 'route RPC is not executable by anon');
select ok(not has_function_privilege('anon','public.mes_validate_bootstrap_topology(jsonb)','execute'), 'topology validator is not executable by anon');

select ok(has_function_privilege('authenticated','public.mes_master_save_work_center(text,text,text,text,text,text,boolean)','execute'), 'authenticated can execute work-center editor RPC');
select ok(has_function_privilege('authenticated','public.mes_master_save_route(text,text,text,text,text,integer,boolean,date,date,text)','execute'), 'authenticated can execute route editor RPC');

select * from finish();
