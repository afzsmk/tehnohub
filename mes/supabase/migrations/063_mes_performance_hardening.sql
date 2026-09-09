-- MES performance hardening identified by production database advisors.

create index if not exists idx_production_orders_product on public.production_orders(product_id);

drop policy if exists mes_read_own_user_employee on public.mes_user_employee;
create policy mes_read_own_user_employee on public.mes_user_employee
for select to authenticated
using (user_id = (select auth.uid()) or mes_has_role(array['ADMIN','PRODUCTION_MANAGER']));
