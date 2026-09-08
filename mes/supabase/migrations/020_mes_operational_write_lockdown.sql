-- Operational MES state is mutated through SECURITY DEFINER RPCs only.
-- Browser sessions keep read access, but cannot bypass lifecycle, optimistic-lock,
-- route/resource and execution validation with direct table writes.

drop policy if exists mes_manage_plans on operational_plans;
create policy mes_no_direct_plan_write on operational_plans
for all to authenticated using (false) with check (false);

drop policy if exists mes_manage_orders on production_orders;
create policy mes_no_direct_order_write on production_orders
for all to authenticated using (false) with check (false);

drop policy if exists mes_manage_tasks on production_tasks;
create policy mes_no_direct_task_write on production_tasks
for all to authenticated using (false) with check (false);

drop policy if exists mes_manage_assignments on task_assignments;
create policy mes_no_direct_assignment_write on task_assignments
for all to authenticated using (false) with check (false);

comment on policy mes_no_direct_order_write on production_orders is
'Direct browser mutation is forbidden; use MES lifecycle/planning RPCs.';
comment on policy mes_no_direct_task_write on production_tasks is
'Direct browser mutation is forbidden; use MES planning/execution RPCs.';
comment on policy mes_no_direct_assignment_write on task_assignments is
'Direct browser mutation is forbidden; use mes_assign_task RPC.';
