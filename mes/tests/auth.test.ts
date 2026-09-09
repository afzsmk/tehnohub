import { describe, expect, it, afterEach } from 'vitest';
import { getMesAuthState, resolveMesIdentity } from '../src/integration/auth';
import type { MesState } from '../src/types';

function fakeIdentityClient(user: unknown, mapping: unknown, mappingError: unknown = null) {
  return {
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null }, error: null })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mapping, error: mappingError })
        })
      })
    })
  } as never;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); }
  };
}

describe('MES authenticated identity', () => {
  it('resolves role and active employee mapping', async () => {
    const identity = await resolveMesIdentity(fakeIdentityClient(
      { id: 'USER-1', app_metadata: { mes_role: 'OPERATOR' } },
      { employee_id: 'E-1', active: true }
    ));
    expect(identity).toEqual({ userId: 'USER-1', employeeId: 'E-1', role: 'OPERATOR' });
  });

  it('returns null when session is absent', async () => {
    await expect(resolveMesIdentity(fakeIdentityClient(null, null))).resolves.toBeNull();
  });

  it('rejects a role missing from auth metadata', async () => {
    await expect(resolveMesIdentity(fakeIdentityClient(
      { id: 'USER-1', app_metadata: {} },
      { employee_id: 'E-1', active: true }
    ))).rejects.toThrow('MES роль');
  });

  it('rejects an operator without active employee mapping', async () => {
    await expect(resolveMesIdentity(fakeIdentityClient(
      { id: 'USER-1', app_metadata: { mes_role: 'OPERATOR' } },
      null
    ))).rejects.toThrow('employeeId');
  });
});

describe('MES auth remote hydration', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else (globalThis as { window?: Window }).window = originalWindow;
  });

  it('hydrates the local cache from the authoritative runtime snapshot RPC', async () => {
    const storage = memoryStorage();
    const reloadCalls: number[] = [];
    (globalThis as { window?: Window }).window = {
      localStorage: storage,
      location: { reload: () => reloadCalls.push(1) } as Location
    } as Window;

    const fallback: MesState = {
      plan: { id: 'PLAN-1', version: 1, horizonStart: '2026-01-01', horizonEnd: '2026-01-30', status: 'DRAFT' },
      products: [], employees: [], equipment: [], shifts: [], calendar: [], employeeSchedules: [],
      equipmentBlocks: [], orders: [], tasks: [], downtimes: [], maintenance: [], results: [], qualityInspections: [], events: []
    };
    storage.setItem('zsmk_mes_state_v1', JSON.stringify(fallback));

    let rpcName = '';
    let rpcArgs: Record<string, unknown> | undefined;
    const client = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'USER-1', email: 'operator@example.test', app_metadata: { mes_role: 'OPERATOR' } } } },
          error: null
        })
      },
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { employee_id: 'E-1', active: true }, error: null }) })
        })
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcName = name;
        rpcArgs = args;
        return {
          data: {
            plan: fallback.plan,
            products: [], employees: [{ id: 'E-1', personnelNo: '1', name: 'Operator', profession: 'Operator', qualificationLevel: 3, active: true }],
            equipment: [], shifts: [], calendar: [], employeeSchedules: [], equipmentBlocks: [], orders: [], tasks: [],
            downtimes: [], maintenance: [], results: [],
            qualityInspections: [{ id: 'QI-1', taskId: 'TASK-1', inspectedAt: '2026-01-02T10:00:00Z', inspectorId: 'USER-Q', status: 'APPROVED', goodQuantity: 10, scrapQuantity: 0 }],
            events: [], calendarRevision: 4
          },
          error: null
        };
      }
    } as never;

    const result = await getMesAuthState(client);

    expect(result.identity).toEqual({ userId: 'USER-1', employeeId: 'E-1', role: 'OPERATOR' });
    expect(rpcName).toBe('mes_get_runtime_snapshot');
    expect(rpcArgs).toEqual({ p_plan_id: 'PLAN-1' });
    expect(reloadCalls).toHaveLength(1);
    expect(JSON.parse(storage.getItem('zsmk_mes_state_v1') ?? '{}').qualityInspections).toHaveLength(1);
  });
});
