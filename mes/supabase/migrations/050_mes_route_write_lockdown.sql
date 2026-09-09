-- Route operations are authoritative MES master data. Keep reads available to
-- authenticated users, but force all writes through validated SECURITY DEFINER RPCs
-- so the concurrency locks in 047 cannot be bypassed by table writes.

drop policy if exists mes_manage_route_operations on route_operations;

revoke insert, update, delete on route_operations from authenticated;

revoke all on function mes_save_route_operation(text,text,integer,text,text,text,integer,jsonb,integer,numeric,boolean) from public;
grant execute on function mes_save_route_operation(text,text,integer,text,text,text,integer,jsonb,integer,numeric,boolean) to authenticated;

revoke all on function mes_delete_route_operation(text) from public;
grant execute on function mes_delete_route_operation(text) to authenticated;
