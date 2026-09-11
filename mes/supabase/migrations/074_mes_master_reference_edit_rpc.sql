-- Controlled server-side edit API for normalized MES reference data.

create or replace function mes_master_save_profession(p_id text,p_external_id text,p_code text,p_name text,p_description text,p_active boolean)
returns professions language plpgsql security definer set search_path=public as $$
declare v professions%rowtype; begin perform mes_require_master_editor(); insert into professions(id,external_id,code,name,description,active) values(trim(p_id),nullif(trim(p_external_id),''),trim(p_code),trim(p_name),nullif(trim(p_description),''),coalesce(p_active,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,description=excluded.description,active=excluded.active returning * into v; return v; end; $$;
create or replace function mes_master_save_qualification(p_id text,p_external_id text,p_code text,p_name text,p_level integer,p_description text,p_active boolean)
returns qualification_levels language plpgsql security definer set search_path=public as $$
declare v qualification_levels%rowtype; begin perform mes_require_master_editor(); if p_level<0 then raise exception 'Уровень квалификации не может быть отрицательным'; end if; insert into qualification_levels(id,external_id,code,name,level,description,active) values(trim(p_id),nullif(trim(p_external_id),''),trim(p_code),trim(p_name),p_level,nullif(trim(p_description),''),coalesce(p_active,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,level=excluded.level,description=excluded.description,active=excluded.active returning * into v; return v; end; $$;
create or replace function mes_master_save_brigade(p_id text,p_external_id text,p_code text,p_name text,p_description text,p_active boolean)
returns brigades language plpgsql security definer set search_path=public as $$
declare v brigades%rowtype; begin perform mes_require_master_editor(); insert into brigades(id,external_id,code,name,description,active) values(trim(p_id),nullif(trim(p_external_id),''),trim(p_code),trim(p_name),nullif(trim(p_description),''),coalesce(p_active,true)) on conflict(id) do update set external_id=excluded.external_id,code=excluded.code,name=excluded.name,description=excluded.description,active=excluded.active returning * into v; return v; end; $$;
create or replace function mes_master_save_downtime_reason(p_code text,p_name text,p_category text,p_is_planned boolean,p_description text,p_active boolean)
returns downtime_reasons language plpgsql security definer set search_path=public as $$
declare v downtime_reasons%rowtype; begin perform mes_require_master_editor(); insert into downtime_reasons(code,name,category,is_planned,description,active) values(trim(p_code),trim(p_name),coalesce(nullif(trim(p_category),''),'OTHER'),coalesce(p_is_planned,false),nullif(trim(p_description),''),coalesce(p_active,true)) on conflict(code) do update set name=excluded.name,category=excluded.category,is_planned=excluded.is_planned,description=excluded.description,active=excluded.active returning * into v; return v; end; $$;
create or replace function mes_master_save_scrap_reason(p_code text,p_name text,p_category text,p_description text,p_active boolean)
returns scrap_reasons language plpgsql security definer set search_path=public as $$
declare v scrap_reasons%rowtype; begin perform mes_require_master_editor(); insert into scrap_reasons(code,name,category,description,active) values(trim(p_code),trim(p_name),coalesce(nullif(trim(p_category),''),'OTHER'),nullif(trim(p_description),''),coalesce(p_active,true)) on conflict(code) do update set name=excluded.name,category=excluded.category,description=excluded.description,active=excluded.active returning * into v; return v; end; $$;
grant execute on function mes_master_save_profession(text,text,text,text,text,boolean) to authenticated;
grant execute on function mes_master_save_qualification(text,text,text,text,integer,text,boolean) to authenticated;
grant execute on function mes_master_save_brigade(text,text,text,text,text,boolean) to authenticated;
grant execute on function mes_master_save_downtime_reason(text,text,text,boolean,text,boolean) to authenticated;
grant execute on function mes_master_save_scrap_reason(text,text,text,text,boolean) to authenticated;
