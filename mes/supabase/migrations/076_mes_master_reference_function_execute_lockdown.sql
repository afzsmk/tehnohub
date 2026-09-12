-- Master-data SECURITY DEFINER RPCs are browser-facing for authenticated MES master editors,
-- but must never be executable by anon/public.

revoke execute on function mes_validate_bootstrap(jsonb) from public, anon;
revoke execute on function mes_import_bootstrap(text, jsonb) from public, anon;
revoke execute on function mes_master_save_product(text, text, text, text, text) from public, anon;
revoke execute on function mes_master_save_employee(text, text, text, text, integer, boolean) from public, anon;
revoke execute on function mes_master_save_equipment(text, text, text, text, jsonb, boolean) from public, anon;
revoke execute on function mes_master_save_shift(text, text, integer, integer, boolean) from public, anon;
revoke execute on function mes_master_save_profession(text, text, text, text, text, boolean) from public, anon;
revoke execute on function mes_master_save_qualification(text, text, text, text, integer, text, boolean) from public, anon;
revoke execute on function mes_master_save_brigade(text, text, text, text, text, boolean) from public, anon;
revoke execute on function mes_master_save_downtime_reason(text, text, text, boolean, text, boolean) from public, anon;
revoke execute on function mes_master_save_scrap_reason(text, text, text, text, boolean) from public, anon;
revoke execute on function mes_master_save_route_operation(text, text, integer, text, text, text, integer, jsonb, numeric, numeric, integer, boolean) from public, anon;
