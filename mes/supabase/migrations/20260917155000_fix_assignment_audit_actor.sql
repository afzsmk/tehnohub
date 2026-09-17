-- The qualification/equipment guard migration records assignment changes in audit_log.
-- Declare the actor inside mes_assign_task before it is referenced.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.mes_assign_task(text,jsonb,jsonb,integer)'::regprocedure)
    into v_def;
  if position('v_actor text' in v_def) = 0 then
    v_def := replace(
      v_def,
      'v_effective_equipment_ids jsonb;',
      'v_effective_equipment_ids jsonb; v_actor text := auth.uid()::text;'
    );
  end if;
  if position('v_actor text' in v_def) = 0 then
    raise exception 'Не удалось добавить v_actor в mes_assign_task';
  end if;
  execute v_def;
end;
$$;
