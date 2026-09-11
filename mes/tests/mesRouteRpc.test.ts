import { describe, expect, it } from 'vitest';
import { SupabaseMesRouteRpc } from '../src/integration/mesRouteRpc';

function fakeClient(response: unknown, responseError: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error: responseError };
    }
  } as never;
}

const dbOperation = {
  id: 'OP-CUT-10',
  product_id: 'P-001',
  sequence: 10,
  code: 'CUT',
  name: 'Раскрой',
  work_center: 'Лазерная резка',
  required_qualification: 3,
  required_equipment_ids: ['EQ-001'],
  setup_minutes: 30,
  run_minutes_per_unit: 1.2,
  active: true,
  labor_norm_hours_per_unit: 0.02,
  setup_norm_hours: 0.5,
  workers_required: 1
};

describe('Supabase MES route RPC', () => {
  it('maps and serializes a route operation', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesRouteRpc(fakeClient(dbOperation, null, (name, args) => { called = { name, args }; }));

    const operation = await rpc.save({
      id: 'OP-CUT-10',
      productId: 'P-001',
      sequence: 10,
      code: 'CUT',
      name: 'Раскрой',
      workCenter: 'Лазерная резка',
      requiredQualification: 3,
      requiredEquipmentIds: ['EQ-001'],
      setupMinutes: 30,
      runMinutesPerUnit: 1.2,
      laborNormHoursPerUnit: 0.02,
      setupNormHours: 0.5,
      workersRequired: 1,
      active: true
    });

    expect(called?.name).toBe('mes_master_save_route_operation');
    expect(called?.args).toMatchObject({
      p_id: 'OP-CUT-10',
      p_product_id: 'P-001',
      p_sequence: 10,
      p_required_equipment_ids: ['EQ-001'],
      p_setup_norm_hours: 0.5,
      p_labor_norm_hours_per_unit: 0.02,
      p_workers_required: 1,
      p_active: true
    });
    expect(operation).toEqual({
      id: 'OP-CUT-10',
      sequence: 10,
      code: 'CUT',
      name: 'Раскрой',
      workCenter: 'Лазерная резка',
      requiredQualification: 3,
      requiredEquipmentIds: ['EQ-001'],
      laborNormHoursPerUnit: 0.02,
      setupNormHours: 0.5,
      workersRequired: 1,
      setupMinutes: 30,
      runMinutesPerUnit: 1.2
    });
  });

  it('propagates delete errors', async () => {
    const rpc = new SupabaseMesRouteRpc(fakeClient(null, new Error('permission denied')));
    await expect(rpc.remove('OP-CUT-10')).rejects.toThrow('permission denied');
  });
});
