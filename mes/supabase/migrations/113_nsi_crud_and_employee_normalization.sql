-- Master-data CRUD and normalized employee reference handling.
-- Browser writes remain behind the master editor authorization guard.

create or replace function public.mes_master_save_employee(
  p_id text,
  p_personnel_no text,
  p_name text,
  p_profession_id text,
  p_qualification_id text,
  p_brigade_id text,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r employees%rowtype;
  v_profession professions%rowtype;
  v_qualification qualification_levels%rowtype;
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null or nullif(trim(p_personnel_no),'') is null or nullif(trim(p_name),'') is null then
    raise exception 'ID, табельный номер и ФИО обязательны';
  end if;

  select * into v_profession from professions where id=trim(p_profession_id) and active=true;
  if not found then
    raise exception 'Выберите активную профессию из справочника';
  end if;

  if nullif(trim(p_qualification_id),'') is not null then
    select * into v_qualification from qualification_levels where id=trim(p_qualification_id) and active=true;
    if not found then
      raise exception 'Выбрана недействующая квалификация';
    end if;
  end if;

  if nullif(trim(p_brigade_id),'') is not null and not exists(select 1 from brigades where id=trim(p_brigade_id) and active=true) then
    raise exception 'Выбрана недействующая бригада';
  end if;

  insert into employees(id,personnel_no,name,profession,qualification_level,active,profession_id,qualification_id,brigade_id)
  values(
    trim(p_id),trim(p_personnel_no),trim(p_name),v_profession.name,coalesce(v_qualification.level,0),coalesce(p_active,true),
    v_profession.id,nullif(trim(p_qualification_id),''),nullif(trim(p_brigade_id),'')
  )
  on conflict(id) do update set
    personnel_no=excluded.personnel_no,
    name=excluded.name,
    profession=excluded.profession,
    qualification_level=excluded.qualification_level,
    active=excluded.active,
    profession_id=excluded.profession_id,
    qualification_id=excluded.qualification_id,
    brigade_id=excluded.brigade_id;

  select * into r from employees where id=trim(p_id);
  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values(auth.uid()::text,'MES_EMPLOYEE',r.id,'MASTER_DATA_SAVE',null,to_jsonb(r));
  return to_jsonb(r);
end;
$$;

revoke execute on function public.mes_master_save_employee(text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.mes_master_save_employee(text,text,text,text,text,text,boolean) to authenticated;

create or replace function public.mes_master_delete_product(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r products%rowtype; begin perform mes_require_master_editor(); select * into r from products where id=trim(p_id) for update; if not found then raise exception 'Продукт не найден'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'PRODUCT',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from products where id=r.id; exception when foreign_key_violation then raise exception 'Продукт используется в других данных и не может быть удалён. Деактивируйте его.'; end; end; $$;
create or replace function public.mes_master_delete_profession(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r professions%rowtype; begin perform mes_require_master_editor(); select * into r from professions where id=trim(p_id) for update; if not found then raise exception 'Профессия не найдена'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'PROFESSION',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from professions where id=r.id; exception when foreign_key_violation then raise exception 'Профессия используется персоналом или другими данными и не может быть удалена. Деактивируйте её.'; end; end; $$;
create or replace function public.mes_master_delete_qualification(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r qualification_levels%rowtype; begin perform mes_require_master_editor(); select * into r from qualification_levels where id=trim(p_id) for update; if not found then raise exception 'Квалификация не найдена'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'QUALIFICATION',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from qualification_levels where id=r.id; exception when foreign_key_violation then raise exception 'Квалификация используется персоналом или маршрутами и не может быть удалена. Деактивируйте её.'; end; end; $$;
create or replace function public.mes_master_delete_brigade(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r brigades%rowtype; begin perform mes_require_master_editor(); select * into r from brigades where id=trim(p_id) for update; if not found then raise exception 'Бригада не найдена'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'BRIGADE',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from brigades where id=r.id; exception when foreign_key_violation then raise exception 'Бригада используется персоналом и не может быть удалена. Деактивируйте её.'; end; end; $$;
create or replace function public.mes_master_delete_work_center(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r work_centers%rowtype; begin perform mes_require_master_editor(); select * into r from work_centers where id=trim(p_id) for update; if not found then raise exception 'Рабочий центр не найден'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'WORK_CENTER',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from work_centers where id=r.id; exception when foreign_key_violation then raise exception 'Рабочий центр используется оборудованием или маршрутами и не может быть удалён. Деактивируйте его.'; end; end; $$;
create or replace function public.mes_master_delete_employee(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r employees%rowtype; begin perform mes_require_master_editor(); select * into r from employees where id=trim(p_id) for update; if not found then raise exception 'Сотрудник не найден'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'MES_EMPLOYEE',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from employees where id=r.id; exception when foreign_key_violation then raise exception 'Сотрудник используется в других данных и не может быть удалён. Деактивируйте его.'; end; end; $$;
create or replace function public.mes_master_delete_equipment(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r equipment%rowtype; begin perform mes_require_master_editor(); select * into r from equipment where id=trim(p_id) for update; if not found then raise exception 'Оборудование не найдено'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'EQUIPMENT',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from equipment where id=r.id; exception when foreign_key_violation then raise exception 'Оборудование используется в других данных и не может быть удалено. Деактивируйте его.'; end; end; $$;
create or replace function public.mes_master_delete_route(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r routes%rowtype; begin perform mes_require_master_editor(); select * into r from routes where id=trim(p_id) for update; if not found then raise exception 'Маршрут не найден'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'ROUTE',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from routes where id=r.id; exception when foreign_key_violation then raise exception 'Маршрут используется операциями или производственными данными и не может быть удалён. Деактивируйте его.'; end; end; $$;
create or replace function public.mes_master_delete_route_operation(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r route_operations%rowtype; begin perform mes_require_master_editor(); select * into r from route_operations where id=trim(p_id) for update; if not found then raise exception 'Операция маршрута не найдена'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'ROUTE_OPERATION',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); delete from route_operations where id=r.id; end; $$;
create or replace function public.mes_master_delete_shift(p_id text)
returns void language plpgsql security definer set search_path=public as $$ declare r shift_definitions%rowtype; begin perform mes_require_master_editor(); select * into r from shift_definitions where id=trim(p_id) for update; if not found then raise exception 'Смена не найдена'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'SHIFT_DEFINITION',r.id,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from shift_definitions where id=r.id; exception when foreign_key_violation then raise exception 'Смена используется календарём или графиками и не может быть удалена. Деактивируйте её.'; end; end; $$;
create or replace function public.mes_master_delete_downtime_reason(p_code text)
returns void language plpgsql security definer set search_path=public as $$ declare r downtime_reasons%rowtype; begin perform mes_require_master_editor(); select * into r from downtime_reasons where code=trim(p_code) for update; if not found then raise exception 'Причина простоя не найдена'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'DOWNTIME_REASON',r.code,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from downtime_reasons where code=r.code; exception when foreign_key_violation then raise exception 'Причина простоя используется в истории и не может быть удалена. Деактивируйте её.'; end; end; $$;
create or replace function public.mes_master_delete_scrap_reason(p_code text)
returns void language plpgsql security definer set search_path=public as $$ declare r scrap_reasons%rowtype; begin perform mes_require_master_editor(); select * into r from scrap_reasons where code=trim(p_code) for update; if not found then raise exception 'Причина брака не найдена'; end if; insert into audit_log(actor_id,entity_type,entity_id,action,before_state) values(auth.uid()::text,'SCRAP_REASON',r.code,'MASTER_DATA_DELETE',to_jsonb(r)); begin delete from scrap_reasons where code=r.code; exception when foreign_key_violation then raise exception 'Причина брака используется в истории и не может быть удалена. Деактивируйте её.'; end; end; $$;

grant execute on function public.mes_master_delete_product(text) to authenticated;
grant execute on function public.mes_master_delete_profession(text) to authenticated;
grant execute on function public.mes_master_delete_qualification(text) to authenticated;
grant execute on function public.mes_master_delete_brigade(text) to authenticated;
grant execute on function public.mes_master_delete_work_center(text) to authenticated;
grant execute on function public.mes_master_delete_employee(text) to authenticated;
grant execute on function public.mes_master_delete_equipment(text) to authenticated;
grant execute on function public.mes_master_delete_route(text) to authenticated;
grant execute on function public.mes_master_delete_route_operation(text) to authenticated;
grant execute on function public.mes_master_delete_shift(text) to authenticated;
grant execute on function public.mes_master_delete_downtime_reason(text) to authenticated;
grant execute on function public.mes_master_delete_scrap_reason(text) to authenticated;

revoke execute on function public.mes_master_delete_product(text), public.mes_master_delete_profession(text), public.mes_master_delete_qualification(text), public.mes_master_delete_brigade(text), public.mes_master_delete_work_center(text), public.mes_master_delete_employee(text), public.mes_master_delete_equipment(text), public.mes_master_delete_route(text), public.mes_master_delete_route_operation(text), public.mes_master_delete_shift(text), public.mes_master_delete_downtime_reason(text), public.mes_master_delete_scrap_reason(text) from public, anon;
