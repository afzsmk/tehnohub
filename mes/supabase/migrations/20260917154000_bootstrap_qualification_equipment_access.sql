create or replace function public.mes_import_bootstrap_v2(
  p_source_name text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r jsonb;
  v_result jsonb;
  v_counts jsonb;
  v_qualification_id text;
  v_equipment_id text;
  v_access_count integer := 0;
begin
  perform mes_require_master_editor();

  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'payload должен быть JSON object';
  end if;

  -- Import the existing bootstrap in one transaction. The old import already
  -- validates and creates qualifications/equipment/routes/employees.
  v_result := mes_import_bootstrap(p_source_name,p_payload);

  for r in select value from jsonb_array_elements(coalesce(p_payload->'qualification_equipment_access','[]'::jsonb)) loop
    v_qualification_id := nullif(trim(r->>'qualification_id'),'');
    v_equipment_id := nullif(trim(r->>'equipment_id'),'');
    if v_qualification_id is null or v_equipment_id is null then
      raise exception 'Qualification equipment access: требуются qualification_id и equipment_id';
    end if;

    if not exists(select 1 from qualification_levels where id=v_qualification_id and active=true) then
      raise exception 'Qualification equipment access: активная qualification % отсутствует',v_qualification_id;
    end if;
    if not exists(select 1 from equipment where id=v_equipment_id and active=true) then
      raise exception 'Qualification equipment access: активное equipment % отсутствует',v_equipment_id;
    end if;
    if nullif(trim(r->>'valid_from'),'') is not null and nullif(trim(r->>'valid_to'),'') is not null
       and (r->>'valid_to')::date < (r->>'valid_from')::date then
      raise exception 'Qualification equipment access: valid_to раньше valid_from для % / %',v_qualification_id,v_equipment_id;
    end if;

    insert into qualification_equipment_access(
      qualification_id,equipment_id,valid_from,valid_to,notes
    ) values(
      v_qualification_id,v_equipment_id,
      nullif(r->>'valid_from','')::date,
      nullif(r->>'valid_to','')::date,
      nullif(r->>'notes','')
    )
    on conflict(qualification_id,equipment_id) do update set
      valid_from=excluded.valid_from,
      valid_to=excluded.valid_to,
      notes=excluded.notes;
    v_access_count:=v_access_count+1;
  end loop;

  v_counts:=coalesce(v_result->'counts','{}'::jsonb);
  v_counts:=jsonb_set(v_counts,'{qualification_equipment_access}',to_jsonb(v_access_count),true);
  return v_result||jsonb_build_object('counts',v_counts);
end;
$$;

revoke all on function public.mes_import_bootstrap_v2(text,jsonb) from public,anon;
grant execute on function public.mes_import_bootstrap_v2(text,jsonb) to authenticated;
