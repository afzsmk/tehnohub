-- Keep non-primary qualifications intact when the simplified employee card
-- updates the employee's primary qualification.
create or replace function public.mes_master_save_employee(
  p_id text,
  p_personnel_no text,
  p_name text,
  p_profession_id text,
  p_qualification_id text,
  p_brigade_id text,
  p_active boolean default true
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  r employees%rowtype;
  v_profession professions%rowtype;
  v_qualification qualification_levels%rowtype;
  v_existing_id bigint;
begin
  perform mes_require_master_editor();
  if nullif(trim(p_id),'') is null or nullif(trim(p_personnel_no),'') is null or nullif(trim(p_name),'') is null then
    raise exception 'ID, табельный номер и ФИО обязательны';
  end if;

  select * into v_profession
  from professions
  where id=trim(p_profession_id) and active=true;
  if not found then raise exception 'Выберите активную профессию из справочника'; end if;

  if nullif(trim(p_qualification_id),'') is not null then
    select * into v_qualification
    from qualification_levels
    where id=trim(p_qualification_id) and active=true;
    if not found then raise exception 'Выбрана недействующая квалификация'; end if;
  end if;

  if nullif(trim(p_brigade_id),'') is not null
     and not exists(select 1 from brigades where id=trim(p_brigade_id) and active=true) then
    raise exception 'Выбрана недействующая бригада';
  end if;

  insert into employees(
    id,personnel_no,name,profession,qualification_level,active,profession_id,qualification_id,brigade_id
  ) values (
    trim(p_id),trim(p_personnel_no),trim(p_name),v_profession.name,
    coalesce(v_qualification.level,0),coalesce(p_active,true),v_profession.id,
    nullif(trim(p_qualification_id),''),nullif(trim(p_brigade_id),'')
  )
  on conflict(id) do update set
    personnel_no=excluded.personnel_no,
    name=excluded.name,
    profession=excluded.profession,
    qualification_level=excluded.qualification_level,
    active=excluded.active,
    profession_id=excluded.profession_id,
    qualification_id=excluded.qualification_id,
    brigade_id=excluded.brigade_id
  returning * into r;

  update employee_qualifications
    set is_primary=false
  where employee_id=r.id;

  if r.qualification_id is not null then
    select id into v_existing_id
    from employee_qualifications
    where employee_id=r.id
      and qualification_id=r.qualification_id
    order by is_primary desc, id
    limit 1;

    if v_existing_id is null then
      insert into employee_qualifications(
        employee_id,qualification_id,valid_from,valid_to,is_primary,notes
      ) values (
        r.id,r.qualification_id,null,null,true,'Синхронизировано из карточки персонала'
      );
    else
      update employee_qualifications
        set is_primary=true
      where id=v_existing_id;
    end if;
  end if;

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values(auth.uid()::text,'MES_EMPLOYEE',r.id,'MASTER_DATA_SAVE',null,to_jsonb(r));
  return to_jsonb(r);
end;
$$;

revoke all on function public.mes_master_save_employee(text,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.mes_master_save_employee(text,text,text,text,text,text,boolean) to authenticated;
