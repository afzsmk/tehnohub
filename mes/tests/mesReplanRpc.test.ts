import { describe, expect, it } from 'vitest';
import { SupabaseMesReplanRpc } from '../src/integration/mesReplanRpc';

function fakeClient(response: unknown, responseError: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error: responseError };
    }
  } as never;
}

describe('Supabase MES replan RPC', () => {
  it('sends an optimistic version and task change set', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesReplanRpc(fakeClient({
      id: 'MES-1', version: 8, horizon_start: '2026-09-01T00:00:00.000Z', horizon_end: '2026-10-01T00:00:00.000Z',
      status: 'RELEASED', source_plan_id: 'WF-1', source_plan_version: 4
    }, null, (name, args) => { called = { name, args }; }));
    const changes = [{ taskId: 'TASK-1', proposedStart: '2026-09-09T08:00:00.000Z', proposedEnd: '2026-09-09T10:00:00.000Z', expectedVersion: 7 }];

    const plan = await rpc.apply('MES-1', 7, changes);

    expect(called?.name).toBe('mes_apply_replan');
    expect(called?.args).toEqual({ p_plan_id: 'MES-1', p_plan_version: 7, p_changes: changes });
    expect(plan).toEqual({
      id: 'MES-1', version: 8, horizonStart: '2026-09-01T00:00:00.000Z', horizonEnd: '2026-10-01T00:00:00.000Z',
      status: 'RELEASED', sourcePlanId: 'WF-1', sourcePlanVersion: 4
    });
  });
});
