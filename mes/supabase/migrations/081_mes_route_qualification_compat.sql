-- Keep the existing numeric qualification field synchronized with the normalized
-- qualification reference so legacy runtime checks remain semantically correct.

create or replace function mes_sync_route_operation_qualification()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_level integer;
begin
  if new.required_qualification_id is not null then
    select level into v_level
      from qualification_levels
     where id = new.required_qualification_id;
    if v_level is null then
      raise exception 'Квалификация операции не найдена: %', new.required_qualification_id;
    end if;
    new.required_qualification := v_level;
  end if;
  return new;
end;
$$;

revoke execute on function mes_sync_route_operation_qualification() from public, anon, authenticated;

drop trigger if exists mes_route_operation_sync_qualification_trg on route_operations;
create trigger mes_route_operation_sync_qualification_trg
before insert or update of required_qualification_id on route_operations
for each row execute function mes_sync_route_operation_qualification();

update route_operations ro
   set required_qualification = q.level
  from qualification_levels q
 where ro.required_qualification_id = q.id
   and ro.required_qualification is distinct from q.level;
