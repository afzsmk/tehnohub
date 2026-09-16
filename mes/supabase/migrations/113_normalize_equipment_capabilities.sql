-- Normalize equipment capabilities and keep the legacy JSONB field synchronized.

DO $$
BEGIN
  DELETE FROM equipment_capabilities a
  USING equipment_capabilities b
  WHERE a.ctid < b.ctid
    AND a.equipment_id = b.equipment_id
    AND a.operation_code = b.operation_code;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_capability
  ON equipment_capabilities (equipment_id, operation_code);

CREATE OR REPLACE FUNCTION public.mes_master_save_equipment_v2(
  p_id text,
  p_code text,
  p_name text,
  p_work_center_id text,
  p_capabilities jsonb,
  p_active boolean
)
RETURNS public.equipment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v equipment%rowtype;
  v_work_center_name text;
  v_capability text;
begin
  perform mes_require_master_editor();

  if nullif(trim(p_id),'') is null
     or nullif(trim(p_code),'') is null
     or nullif(trim(p_name),'') is null
     or nullif(trim(p_work_center_id),'') is null then
    raise exception 'Для оборудования обязательны id, code, name и work_center_id';
  end if;

  select name into v_work_center_name
  from work_centers
  where id=trim(p_work_center_id) and active=true;
  if v_work_center_name is null then
    raise exception 'Активный рабочий центр не найден: %',p_work_center_id;
  end if;

  if p_capabilities is null then p_capabilities:='[]'::jsonb; end if;
  if jsonb_typeof(p_capabilities)<>'array' then
    raise exception 'capabilities должен быть JSON array';
  end if;

  insert into equipment(id,code,name,work_center,capabilities,active,work_center_id)
  values(trim(p_id),trim(p_code),trim(p_name),v_work_center_name,p_capabilities,coalesce(p_active,true),trim(p_work_center_id))
  on conflict(id) do update set
    code=excluded.code,
    name=excluded.name,
    work_center=excluded.work_center,
    capabilities=excluded.capabilities,
    active=excluded.active,
    work_center_id=excluded.work_center_id
  returning * into v;

  delete from equipment_capabilities where equipment_id=v.id;

  for v_capability in
    select distinct trim(value)
    from jsonb_array_elements_text(p_capabilities)
    where nullif(trim(value),'') is not null
  loop
    insert into equipment_capabilities(
      equipment_id, operation_code, capability_level, valid_from, valid_to, notes
    ) values (
      v.id, v_capability, 'STANDARD', current_date, null, 'MES NSI equipment capability'
    );
  end loop;

  insert into audit_log(actor_id,entity_type,entity_id,action,after_state)
  values(auth.uid()::text,'EQUIPMENT',v.id,'MASTER_DATA_SAVE_V2',to_jsonb(v));

  return v;
end;
$$;

REVOKE ALL ON FUNCTION public.mes_master_save_equipment_v2(text,text,text,text,jsonb,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mes_master_save_equipment_v2(text,text,text,text,jsonb,boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.mes_master_save_equipment_v2(text,text,text,text,jsonb,boolean) TO authenticated;

INSERT INTO equipment_capabilities(equipment_id, operation_code, capability_level, valid_from, notes)
SELECT e.id, trim(x.value), 'STANDARD', current_date, 'Backfilled from equipment.capabilities'
FROM equipment e
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.capabilities,'[]'::jsonb)) x(value)
WHERE jsonb_typeof(COALESCE(e.capabilities,'[]'::jsonb))='array'
  AND nullif(trim(x.value),'') IS NOT NULL
ON CONFLICT (equipment_id, operation_code) DO NOTHING;
