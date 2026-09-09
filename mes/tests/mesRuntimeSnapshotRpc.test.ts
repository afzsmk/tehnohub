import { describe, expect, it } from 'vitest';
import { SupabaseMesRuntimeSnapshotRpc } from '../src/integration/mesRuntimeSnapshotRpc';

function fakeClient(response: unknown, error: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error };
    }
  } as never;
}

describe('Supabase MES runtime snapshot RPC', () => {
  it('requests a plan-aware authoritative snapshot', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const snapshot = {
      plan: { id: 'PLAN-1', version: 7, horizonStart: '2026-09-09T00:00:00.000Z', horizonEnd: '2026-10-09T00:00:00.000Z', status: 'RELEASED' }
    };
    const rpc = new SupabaseMesRuntimeSnapshotRpc(fakeClient(snapshot, null, (name, args) => { called = { name, args }; }));

    await expect(rpc.load('PLAN-1')).resolves.toEqual(snapshot);
    expect(called).toEqual({ name: 'mes_get_runtime_snapshot', args: { p_plan_id: 'PLAN-1' } });
  });

  it('passes null when no preferred plan is available', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesRuntimeSnapshotRpc(fakeClient({ plan: null }, null, (name, args) => { called = { name, args }; }));

    await rpc.load();
    expect(called?.name).toBe('mes_get_runtime_snapshot');
    expect(called?.args).toEqual({ p_plan_id: null });
  });

  it('propagates snapshot RPC errors', async () => {
    const rpc = new SupabaseMesRuntimeSnapshotRpc(fakeClient(null, new Error('permission denied')));
    await expect(rpc.load()).rejects.toThrow('permission denied');
  });
});
