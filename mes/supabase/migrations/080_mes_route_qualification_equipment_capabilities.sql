-- Normalize route-operation qualification references and equipment capability links.

alter table route_operations add column if not exists required_qualification_id text references qualification_levels(id);

create table if not exists equipment_capabilities (
  id bigserial primary key,
  equipment_id text not null references equipment(id) on delete cascade,
  operation_code text not null,
  capability_level text not null default 'FULL',
  valid_from date,
  valid_to date,
  notes text,
  unique(equipment_id, operation_code)
);
create index if not exists idx_equipment_capabilities_equipment on equipment_capabilities(equipment_id);
create index if not exists idx_equipment_capabilities_operation on equipment_capabilities(operation_code);

alter table equipment_capabilities enable row level security;
drop policy if exists equipment_capabilities_select_authenticated on equipment_capabilities;
create policy equipment_capabilities_select_authenticated on equipment_capabilities for select to authenticated using (true);
revoke insert, update, delete on equipment_capabilities from authenticated;

create or replace function mes_master_save_equipment_capability(p_equipment_id text,p_operation_code text,p_capability_level text,p_valid_from date,p_valid_to date,p_notes text)
returns equipment_capabilities language plpgsql security definer set search_path=public as $$
declare v equipment_capabilities%rowtype;
begin
  perform mes_require_master_editor();
  if not exists(select 1 from equipment where id=trim(p_equipment_id)) then raise exception 'Оборудование % не существует',p_equipment_id; end if;
  insert into equipment_capabilities(equipment_id,operation_code,capability_level,valid_from,valid_to,notes)
  values(trim(p_equipment_id),trim(p_operation_code),coalesce(nullif(trim(p_capability_level),''),'FULL'),p_valid_from,p_valid_to,nullif(trim(p_notes),''))
  on conflict(equipment_id,operation_code) do update set capability_level=excluded.capability_level,valid_from=excluded.valid_from,valid_to=excluded.valid_to,notes=excluded.notes
  returning * into v;
  return v;
end; $$;
grant execute on function mes_master_save_equipment_capability(text,text,text,date,date,text) to authenticated;

create or replace function mes_import_bootstrap(p_source_name text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_validation jsonb; v_topology jsonb; v_run_id text:='IMPORT-'||replace(gen_random_uuid()::text,'-',''); v_actor text:=auth.uid()::text; v_counts jsonb:='{}'::jsonb; r jsonb; n integer; v_wc text; v_route text; v_qual text;
begin
 perform mes_require_master_editor();
 v_validation:=mes_validate_bootstrap(p_payload); if not coalesce((v_validation->>'valid')::boolean,false) then raise exception 'Импорт отклонён: %',v_validation->'errors'; end if;
 v_topology:=mes_validate_bootstrap_topology(p_payload); if not coalesce((v_topology->>'valid')::boolean,false) then raise exception 'Импорт отклонён: %',v_topology->'errors'; end if;
 insert into mes_master_import_runs(id,actor_id,status,source_name) values(v_run_id,v_actor,'STARTED',p_source_name);
 begin
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'professions','[]'::jsonb)) loop insert into professions(id,external_id,code,name,description,active) values(r->>'id',nullif(r->>'external_id',''),r->>'code',r->>'name',nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{professions}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'qualification_levels','[]'::jsonb)) loop insert into qualification_levels(id,external_id,code,name,level,description,active) values(r->>'id',nullif(r->>'external_id',''),r->>'code',r->>'name',coalesce((r->>'level')::integer,0),nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,level=excluded.level,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{qualification_levels}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'brigades','[]'::jsonb)) loop insert into brigades(id,external_id,code,name,description,active) values(r->>'id',nullif(r->>'external_id',''),r->>'code',r->>'name',nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{brigades}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) loop perform mes_master_save_product(r->>'id',r->>'code',r->>'name',r->>'unit',nullif(r->>'external_id','')); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{products}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'work_centers','[]'::jsonb)) loop perform mes_master_save_work_center(r->>'id',r->>'external_id',r->>'code',r->>'name',r->>'site_code',r->>'description',coalesce((r->>'active')::boolean,true)); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{work_centers}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'routes','[]'::jsonb)) loop perform mes_master_save_route(r->>'id',r->>'external_id',r->>'product_id',r->>'code',r->>'name',coalesce((r->>'version')::integer,1),coalesce((r->>'active')::boolean,true),nullif(r->>'valid_from','')::date,nullif(r->>'valid_to','')::date,r->>'description'); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{routes}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) loop insert into employees(id,personnel_no,name,profession,qualification_level,active,profession_id,brigade_id,qualification_id) values(r->>'id',r->>'personnel_no',r->>'name',coalesce(r->>'profession',''),coalesce((r->>'qualification_level')::integer,0),coalesce((r->>'active')::boolean,true),nullif(r->>'profession_id',''),nullif(r->>'brigade_id',''),nullif(r->>'qualification_id','')) on conflict(id) do update set personnel_no=excluded.personnel_no,name=excluded.name,profession=excluded.profession,qualification_level=excluded.qualification_level,active=excluded.active,profession_id=excluded.profession_id,brigade_id=excluded.brigade_id,qualification_id=excluded.qualification_id; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{employees}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'employee_qualifications','[]'::jsonb)) loop insert into employee_qualifications(employee_id,qualification_id,valid_from,valid_to,is_primary,notes) values(r->>'employee_id',r->>'qualification_id',nullif(r->>'valid_from','')::date,nullif(r->>'valid_to','')::date,coalesce((r->>'is_primary')::boolean,false),nullif(r->>'notes','')) on conflict(employee_id,qualification_id,valid_from) do update set valid_to=excluded.valid_to,is_primary=excluded.is_primary,notes=excluded.notes; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{employee_qualifications}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'equipment','[]'::jsonb)) loop v_wc:=null; select id into v_wc from work_centers where id=trim(r->>'work_center') or code=trim(r->>'work_center') limit 1; perform mes_master_save_equipment(r->>'id',r->>'code',r->>'name',coalesce(v_wc,r->>'work_center'),coalesce(r->'capabilities','[]'::jsonb),coalesce((r->>'active')::boolean,true)); update equipment set work_center_id=v_wc where id=r->>'id'; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{equipment}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'equipment_capabilities','[]'::jsonb)) loop perform mes_master_save_equipment_capability(r->>'equipment_id',r->>'operation_code',r->>'capability_level',nullif(r->>'valid_from','')::date,nullif(r->>'valid_to','')::date,r->>'notes'); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{equipment_capabilities}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'shifts','[]'::jsonb)) loop perform mes_master_save_shift(r->>'id',r->>'name',coalesce((r->>'start_minute')::integer,0),coalesce((r->>'duration_minutes')::integer,0),coalesce((r->>'active')::boolean,true)); n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{shifts}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'route_operations','[]'::jsonb)) loop v_route:=null; if nullif(trim(r->>'route_id'),'') is not null then select id into v_route from routes where id=trim(r->>'route_id') limit 1; end if; v_wc:=null; select id into v_wc from work_centers where id=trim(r->>'work_center') or code=trim(r->>'work_center') limit 1; v_qual:=null; if nullif(trim(r->>'required_qualification_id'),'') is not null then select id into v_qual from qualification_levels where id=trim(r->>'required_qualification_id') or code=trim(r->>'required_qualification_id') limit 1; end if; perform mes_master_save_route_operation(r->>'id',r->>'product_id',coalesce((r->>'sequence')::integer,0),r->>'code',r->>'name',coalesce(v_wc,r->>'work_center'),coalesce((r->>'required_qualification')::integer,0),coalesce(r->'required_equipment_ids','[]'::jsonb),coalesce((r->>'setup_norm_hours')::numeric,0),coalesce((r->>'labor_norm_hours_per_unit')::numeric,0),coalesce((r->>'workers_required')::integer,1),coalesce((r->>'active')::boolean,true)); update route_operations set route_id=v_route,work_center_id=v_wc,required_qualification_id=v_qual where id=r->>'id'; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{route_operations}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'calendar_days','[]'::jsonb)) loop insert into calendar_days(date,is_working,shift_ids) values((r->>'date')::date,coalesce((r->>'is_working')::boolean,false),coalesce(r->'shift_ids','[]'::jsonb)) on conflict(date) do update set is_working=excluded.is_working,shift_ids=excluded.shift_ids; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{calendar_days}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'employee_schedules','[]'::jsonb)) loop insert into employee_schedules(employee_id,date,shift_ids,status) values(r->>'employee_id',(r->>'date')::date,coalesce(r->'shift_ids','[]'::jsonb),r->>'status') on conflict(employee_id,date) do update set shift_ids=excluded.shift_ids,status=excluded.status; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{employee_schedules}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'downtime_reasons','[]'::jsonb)) loop insert into downtime_reasons(code,name,category,is_planned,description,active) values(r->>'code',r->>'name',coalesce(r->>'category','OTHER'),coalesce((r->>'is_planned')::boolean,false),nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(code) do update set name=excluded.name,category=excluded.category,is_planned=excluded.is_planned,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{downtime_reasons}',to_jsonb(n),true);
  n:=0; for r in select value from jsonb_array_elements(coalesce(p_payload->'scrap_reasons','[]'::jsonb)) loop insert into scrap_reasons(code,name,category,description,active) values(r->>'code',r->>'name',coalesce(r->>'category','OTHER'),nullif(r->>'description',''),coalesce((r->>'active')::boolean,true)) on conflict(code) do update set name=excluded.name,category=excluded.category,description=excluded.description,active=excluded.active; n:=n+1; end loop; v_counts:=jsonb_set(v_counts,'{scrap_reasons}',to_jsonb(n),true);
  update mes_master_import_runs set status='COMPLETED',finished_at=now(),counts=v_counts where id=v_run_id;
  insert into audit_log(actor_id,entity_type,entity_id,action,after_state) values(v_actor,'MES_MASTER_IMPORT',v_run_id,'MASTER_BOOTSTRAP_IMPORT',jsonb_build_object('source_name',p_source_name,'counts',v_counts));
  return jsonb_build_object('runId',v_run_id,'status','COMPLETED','counts',v_counts);
 exception when others then update mes_master_import_runs set status='FAILED',finished_at=now(),errors=jsonb_build_array(sqlerrm),counts=v_counts where id=v_run_id; raise; end;
end; $$;
grant execute on function mes_import_bootstrap(text,jsonb) to authenticated;
revoke execute on function mes_master_save_equipment_capability(text,text,text,date,date,text) from public,anon;
