-- Central authorization guard for MES master-data SECURITY DEFINER RPCs.
-- Browser-facing master-data RPCs call this function; the guard itself is
-- deliberately not part of the browser RPC surface.

create or replace function public.mes_require_master_editor()
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MASTER']) then
    raise exception 'Недостаточно прав для редактирования НСИ';
  end if;
end;
$$;

revoke execute on function public.mes_require_master_editor() from public, anon, authenticated;

comment on function public.mes_require_master_editor() is
'Internal MES master-data authorization guard. Not a browser RPC.';
