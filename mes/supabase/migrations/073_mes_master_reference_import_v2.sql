-- Extend bootstrap validation/import to cover normalized MES reference data.
-- SECURITY DEFINER functions remain the controlled write boundary.

create or replace function mes_validate_bootstrap(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_errors jsonb:='[]'::jsonb; v_warnings jsonb:='[]'::jsonb; r jsonb; v_id text; v_n integer;
begin
  perform mes_require_master_editor();
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    return jsonb_build_object('valid',false,'errors',jsonb_build_array('payload должен быть JSON object'),'warnings','[]'::jsonb);
  end if;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'professions','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),'');
    if v_id is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Profession %s: требуются id, code, name',coalesce(v_id,'?'))); end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'qualification_levels','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),'');
    if v_id is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Qualification %s: требуются id, code, name',coalesce(v_id,'?'))); end if;
    if coalesce((r->>'level')::integer,-1)<0 then v_errors:=v_errors||jsonb_build_array(format('Qualification %s: некорректный level',coalesce(v_id,'?'))); end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'brigades','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),''); if v_id is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Brigade %s: требуются id, code, name',coalesce(v_id,'?'))); end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),'');
    if v_id is null or nullif(trim(r->>'personnel_no'),'') is null or nullif(trim(r->>'name'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Employee %s: требуются id, personnel_no, name',coalesce(v_id,'?'))); end if;
    if nullif(trim(r->>'profession_id'),'') is not null and not exists(select 1 from jsonb_array_elements(coalesce(p_payload->'professions','[]'::jsonb)) x where trim(x->>'id')=trim(r->>'profession_id')) and not exists(select 1 from professions where id=trim(r->>'profession_id')) then v_errors:=v_errors||jsonb_build_array(format('Employee %s: profession %s отсутствует',v_id,r->>'profession_id')); end if;
    if nullif(trim(r->>'brigade_id'),'') is not null and not exists(select 1 from jsonb_array_elements(coalesce(p_payload->'brigades','[]'::jsonb)) x where trim(x->>'id')=trim(r->>'brigade_id')) and not exists(select 1 from brigades where id=trim(r->>'brigade_id')) then v_errors:=v_errors||jsonb_build_array(format('Employee %s: brigade %s отсутствует',v_id,r->>'brigade_id')); end if;
    if nullif(trim(r->>'qualification_id'),'') is not null and not exists(select 1 from jsonb_array_elements(coalesce(p_payload->'qualification_levels','[]'::jsonb)) x where trim(x->>'id')=trim(r->>'qualification_id')) and not exists(select 1 from qualification_levels where id=trim(r->>'qualification_id')) then v_errors:=v_errors||jsonb_build_array(format('Employee %s: qualification %s отсутствует',v_id,r->>'qualification_id')); end if;
  end loop;
  select count(*) into v_n from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) x where nullif(trim(x->>'id'),'') is not null;
  if v_n <> (select count(distinct nullif(trim(x->>'id'),'') ) from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) x) then v_errors:=v_errors||jsonb_build_array('Employees: найдены дублирующиеся id'); end if;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'employee_qualifications','[]'::jsonb)) loop
    if nullif(trim(r->>'employee_id'),'') is null or nullif(trim(r->>'qualification_id'),'') is null then v_errors:=v_errors||jsonb_build_array('Employee qualifications: требуются employee_id и qualification_id'); end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'downtime_reasons','[]'::jsonb)) loop if nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then v_errors:=v_errors||jsonb_build_array('Downtime reason: требуются code и name'); end if; end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'scrap_reasons','[]'::jsonb)) loop if nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then v_errors:=v_errors||jsonb_build_array('Scrap reason: требуются code и name'); end if; end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),''); if v_id is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null or nullif(trim(r->>'unit'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Product %s: требуются id, code, name, unit',coalesce(v_id,'?'))); end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'equipment','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),''); if v_id is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null or nullif(trim(r->>'work_center'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Equipment %s: требуются id, code, name, work_center',coalesce(v_id,'?'))); end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'shifts','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),''); if v_id is null or nullif(trim(r->>'name'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Shift %s: требуются id и name',coalesce(v_id,'?'))); end if;
    if coalesce((r->>'start_minute')::integer,-1)<0 or coalesce((r->>'start_minute')::integer,-1)>1439 then v_errors:=v_errors||jsonb_build_array(format('Shift %s: некорректный start_minute',coalesce(v_id,'?'))); end if;
    if coalesce((r->>'duration_minutes')::integer,0)<=0 or coalesce((r->>'duration_minutes')::integer,0)>1440 then v_errors:=v_errors||jsonb_build_array(format('Shift %s: некорректная duration_minutes',coalesce(v_id,'?'))); end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'route_operations','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),''); if v_id is null or nullif(trim(r->>'product_id'),'') is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null or nullif(trim(r->>'work_center'),'') is null then v_errors:=v_errors||jsonb_build_array(format('Route operation %s: обязательны id/product_id/code/name/work_center',coalesce(v_id,'?'))); end if;
    if coalesce((r->>'sequence')::integer,0)<=0 then v_errors:=v_errors||jsonb_build_array(format('Route operation %s: некорректный sequence',coalesce(v_id,'?'))); end if;
    if coalesce((r->>'workers_required')::integer,0)<=0 then v_errors:=v_errors||jsonb_build_array(format('Route operation %s: workers_required должен быть > 0',coalesce(v_id,'?'))); end if;
    if coalesce((r->>'labor_norm_hours_per_unit')::numeric,0)<0 or coalesce((r->>'setup_norm_hours')::numeric,0)<0 or (coalesce((r->>'labor_norm_hours_per_unit')::numeric,0)=0 and coalesce((r->>'setup_norm_hours')::numeric,0)=0) then v_errors:=v_errors||jsonb_build_array(format('Route operation %s: нормы н-ч должны быть неотрицательны и не могут одновременно быть 0',coalesce(v_id,'?'))); end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) x where trim(x->>'id')=trim(r->>'product_id')) and not exists(select 1 from products where id=trim(r->>'product_id')) then v_errors:=v_errors||jsonb_build_array(format('Route operation %s: продукт %s отсутствует',v_id,r->>'product_id')); end if;
  end loop;
  return jsonb_build_object('valid',jsonb_array_length(v_errors)=0,'errors',v_errors,'warnings',v_warnings);
end; $$;

grant execute on function mes_validate_bootstrap(jsonb) to authenticated;

create or replace function mes_import_bootstrap(p_source_name text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_validation jsonb; v_run_id text:='IMPORT-'||replace(gen_random_uuid()::text,'-',''); v_actor text:=auth.uid()::text; v_counts jsonb:='{}'::jsonb; r jsonb; n integer;
begin
 perform mes_require_master_editor();
 v_validation:=mes_validate_bootstrap(p_payload); if not coalesce((v_validation->>'valid')::boolean,false) then raise exception 'Импорт отклонён: %',v_validation->'errors'; end if;
 insert into mes_master_import_runs(id,actor_id,status,source_name) values(v_run_id,v_actor,'STARTED',p_source_name);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'professions','[]'::jsonb)) loop insert into professions(id,external_id,code,name,description,active) values(r->>'id',nullif(r->>'external_id',''),r->>'code',r->>'name',nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{professions}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'qualification_levels','[]'::jsonb)) loop insert into qualification_levels(id,external_id,code,name,level,description,active) values(r->>'id',nullif(r->>'external_id',''),r->>'code',r->>'name',coalesce((r->>'level')::integer,0),nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,level=excluded.level,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{qualification_levels}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'brigades','[]'::jsonb)) loop insert into brigades(id,external_id,code,name,description,active) values(r->>'id',nullif(r->>'external_id',''),r->>'code',r->>'name',nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{brigades}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) loop perform mes_master_save_product(r->>'id',r->>'code',r->>'name',r->>'unit',nullif(r->>'external_id','')); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{products}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) loop insert into employees(id,personnel_no,name,profession,qualification_level,active,profession_id,brigade_id,qualification_id) values(r->>'id',r->>'personnel_no',r->>'name',coalesce(r->>'profession',''),coalesce((r->>'qualification_level')::integer,0),coalesce((r->>'active')::boolean,true),nullif(r->>'profession_id',''),nullif(r->>'brigade_id',''),nullif(r->>'qualification_id','')) on conflict(id) do update set personnel_no=excluded.personnel_no,name=excluded.name,profession=excluded.profession,qualification_level=excluded.qualification_level,active=excluded.active,profession_id=excluded.profession_id,brigade_id=excluded.brigade_id,qualification_id=excluded.qualification_id; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{employees}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'employee_qualifications','[]'::jsonb)) loop insert into employee_qualifications(employee_id,qualification_id,valid_from,valid_to,is_primary,notes) values(r->>'employee_id',r->>'qualification_id',nullif(r->>'valid_from','')::date,nullif(r->>'valid_to','')::date,coalesce((r->>'is_primary')::boolean,false),nullif(r->>'notes','')) on conflict(employee_id,qualification_id,valid_from) do update set valid_to=excluded.valid_to,is_primary=excluded.is_primary,notes=excluded.notes; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{employee_qualifications}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'equipment','[]'::jsonb)) loop perform mes_master_save_equipment(r->>'id',r->>'code',r->>'name',r->>'work_center',coalesce(r->'capabilities','[]'::jsonb),coalesce((r->>'active')::boolean,true)); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{equipment}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'shifts','[]'::jsonb)) loop perform mes_master_save_shift(r->>'id',r->>'name',coalesce((r->>'start_minute')::integer,0),coalesce((r->>'duration_minutes')::integer,0),coalesce((r->>'active')::boolean,true)); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{shifts}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'route_operations','[]'::jsonb)) loop perform mes_master_save_route_operation(r->>'id',r->>'product_id',coalesce((r->>'sequence')::integer,0),r->>'code',r->>'name',r->>'work_center',(r->>'required_qualification')::integer,coalesce(r->'required_equipment_ids','[]'::jsonb),coalesce((r->>'setup_norm_hours')::numeric,0),coalesce((r->>'labor_norm_hours_per_unit')::numeric,0),coalesce((r->>'workers_required')::integer,1),coalesce((r->>'active')::boolean,true)); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{route_operations}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'calendar_days','[]'::jsonb)) loop insert into calendar_days(date,is_working,shift_ids) values((r->>'date')::date,coalesce((r->>'is_working')::boolean,false),coalesce(r->'shift_ids','[]'::jsonb)) on conflict(date) do update set is_working=excluded.is_working,shift_ids=excluded.shift_ids; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{calendar_days}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'employee_schedules','[]'::jsonb)) loop insert into employee_schedules(employee_id,date,shift_ids,status) values(r->>'employee_id',(r->>'date')::date,coalesce(r->'shift_ids','[]'::jsonb),r->>'status') on conflict(employee_id,date) do update set shift_ids=excluded.shift_ids,status=excluded.status; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{employee_schedules}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'downtime_reasons','[]'::jsonb)) loop insert into downtime_reasons(code,name,category,is_planned,description,active) values(r->>'code',r->>'name',coalesce(r->>'category','OTHER'),coalesce((r->>'is_planned')::boolean,false),nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(code) do update set name=excluded.name,category=excluded.category,is_planned=excluded.is_planned,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{downtime_reasons}',to_jsonb(n),true);
 n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'scrap_reasons','[]'::jsonb)) loop insert into scrap_reasons(code,name,category,description,active) values(r->>'code',r->>'name',coalesce(r->>'category','OTHER'),nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(code) do update set name=excluded.name,category=excluded.category,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{scrap_reasons}',to_jsonb(n),true);
 update mes_master_import_runs set status='COMPLETED',finished_at=now(),counts=v_counts where id=v_run_id;
 insert into audit_log(actor_id,entity_type,entity_id,action,after_state) values(v_actor,'MES_MASTER_IMPORT',v_run_id,'MASTER_BOOTSTRAP_IMPORT',jsonb_build_object('source_name',p_source_name,'counts',v_counts));
 return jsonb_build_object('runId',v_run_id,'status','COMPLETED','counts',v_counts);
exception when others then update mes_master_import_runs set status='FAILED',finished_at=now(),errors=jsonb_build_array(sqlerrm),counts=v_counts where id=v_run_id; raise; end; $$;
grant execute on function mes_import_bootstrap(text,jsonb) to authenticated;
