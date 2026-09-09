import { describe, expect, it } from 'vitest';
import { resolveMesIdentity } from '../src/integration/identitySession';

function fakeClient(user: unknown, mapping: unknown, mappingError: unknown = null) {
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

describe('MES authenticated identity', () => {
  it('resolves role and active employee mapping', async () => {
    const identity = await resolveMesIdentity(fakeClient(
      { id: 'USER-1', app_metadata: { mes_role: 'OPERATOR' } },
      { employee_id: 'E-1', active: true }
    ));
    expect(identity).toEqual({ userId: 'USER-1', employeeId: 'E-1', role: 'OPERATOR' });
  });

  it('returns null when session is absent', async () => {
    await expect(resolveMesIdentity(fakeClient(null, null))).resolves.toBeNull();
  });

  it('rejects a role missing from auth metadata', async () => {
    await expect(resolveMesIdentity(fakeClient(
      { id: 'USER-1', app_metadata: {} },
      { employee_id: 'E-1', active: true }
    ))).rejects.toThrow('MES роль');
  });

  it('rejects an operator without active employee mapping', async () => {
    await expect(resolveMesIdentity(fakeClient(
      { id: 'USER-1', app_metadata: { mes_role: 'OPERATOR' } },
      null
    ))).rejects.toThrow('employeeId');
  });
});
