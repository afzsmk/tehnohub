import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');

function migration(name: string): string {
  return readFileSync(resolve(migrationsDir, name), 'utf8');
}

describe('MES SQL security baseline', () => {
  it('locks master and runtime tables against direct authenticated writes', () => {
    const sql = migration('054_mes_master_runtime_write_lockdown.sql');
    for (const table of [
      'products',
      'employees',
      'equipment',
      'shift_definitions',
      'equipment_blocks',
      'maintenance_orders'
    ]) {
      expect(sql).toContain(`revoke insert, update, delete on ${table} from authenticated`);
    }
    expect(sql).toContain('using (false) with check (false)');
  });

  it('removes implicit PUBLIC execution from SECURITY DEFINER MES functions', () => {
    const sql = migration('052_mes_function_public_execute_lockdown.sql');
    expect(sql).toContain('p.prosecdef');
    expect(sql).toContain('revoke execute on function');
    expect(sql).toContain('from public');
  });

  it('protects calendar persistence with an explicit revision precondition', () => {
    const sql = migration('048_mes_calendar_optimistic_lock.sql');
    expect(sql).toContain('p_expected_revision bigint');
    expect(sql).toContain('for update');
    expect(sql).toContain('p_expected_revision <> v_revision');
    expect(sql).toContain('revoke execute on function mes_save_calendar(jsonb,jsonb) from authenticated');
  });

  it('keeps route, execution and operational facts behind controlled APIs', () => {
    const route = migration('050_mes_route_write_lockdown.sql');
    const execution = migration('051_mes_execution_write_lockdown.sql');
    const operational = migration('020_mes_operational_write_lockdown.sql');

    expect(route).toContain('revoke insert, update, delete on route_operations from authenticated');
    expect(execution).toContain('mes_no_direct_quality_inspection_write');
    expect(execution).toContain('mes_no_direct_result_write');
    expect(execution).toContain('mes_no_direct_event_write');
    expect(operational).toContain('mes_no_direct_order_write');
    expect(operational).toContain('mes_no_direct_task_write');
    expect(operational).toContain('mes_no_direct_assignment_write');
  });
});
