-- MES master and runtime state must not be mutable directly by browser sessions.
-- Master-data changes can be introduced by controlled administrative tooling or
-- service-role migrations; runtime changes must use validated MES RPCs.

-- Master data: reads remain available through the existing RLS read policies.
drop policy if exists mes_no_direct_product_write on products;
drop policy if exists mes_manage_products on products;
create policy mes_no_direct_product_write on products
for all to authenticated using (false) with check (false);

drop policy if exists mes_no_direct_employee_write on employees;
drop policy if exists mes_manage_employees on employees;
create policy mes_no_direct_employee_write on employees
for all to authenticated using (false) with check (false);

drop policy if exists mes_no_direct_equipment_write on equipment;
drop policy if exists mes_manage_equipment on equipment;
create policy mes_no_direct_equipment_write on equipment
for all to authenticated using (false) with check (false);

drop policy if exists mes_no_direct_shift_write on shift_definitions;
drop policy if exists mes_manage_shifts on shift_definitions;
create policy mes_no_direct_shift_write on shift_definitions
for all to authenticated using (false) with check (false);

-- Runtime state already has dedicated RPCs and therefore must not be writable
-- through the generic table API.
drop policy if exists mes_no_direct_block_write on equipment_blocks;
drop policy if exists mes_manage_blocks on equipment_blocks;
create policy mes_no_direct_block_write on equipment_blocks
for all to authenticated using (false) with check (false);

drop policy if exists mes_no_direct_maintenance_write on maintenance_orders;
drop policy if exists mes_manage_maintenance on maintenance_orders;
create policy mes_no_direct_maintenance_write on maintenance_orders
for all to authenticated using (false) with check (false);

revoke insert, update, delete on products from authenticated;
revoke insert, update, delete on employees from authenticated;
revoke insert, update, delete on equipment from authenticated;
revoke insert, update, delete on shift_definitions from authenticated;
revoke insert, update, delete on equipment_blocks from authenticated;
revoke insert, update, delete on maintenance_orders from authenticated;

comment on policy mes_no_direct_product_write on products is
'Direct browser mutation is forbidden; use controlled MES master-data tooling.';
comment on policy mes_no_direct_employee_write on employees is
'Direct browser mutation is forbidden; use controlled MES master-data tooling.';
comment on policy mes_no_direct_equipment_write on equipment is
'Direct browser mutation is forbidden; use controlled MES master-data tooling.';
comment on policy mes_no_direct_shift_write on shift_definitions is
'Direct browser mutation is forbidden; use controlled MES calendar/master-data tooling.';
comment on policy mes_no_direct_block_write on equipment_blocks is
'Direct browser mutation is forbidden; use MES equipment block RPCs.';
comment on policy mes_no_direct_maintenance_write on maintenance_orders is
'Direct browser mutation is forbidden; use MES maintenance RPCs.';
