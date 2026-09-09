import { describe, expect, it } from 'vitest';
import { SupabaseMesCalendarRpc } from '../src/integration/mesCalendarRpc';

function fakeClient(responseError: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: { accepted: true }, error: responseError };
    }
  } as never;
}

describe('Supabase MES calendar RPC', () => {
  it('serializes calendar days and employee schedules to the server contract', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesCalendarRpc(fakeClient(null, (name, args) => { called = { name, args }; }));

    await rpc.saveCalendar(
      [{ date: '2026-09-08', isWorking: true, shiftIds: ['SHIFT-DAY'] }],
      [{ employeeId: 'E-1', date: '2026-09-08', status: 'WORK', shiftIds: ['SHIFT-DAY'] }]
    );

    expect(called?.name).toBe('mes_save_calendar');
    expect(called?.args).toEqual({
      p_calendar: [{ date: '2026-09-08', isWorking: true, shiftIds: ['SHIFT-DAY'] }],
      p_employee_schedules: [{ employeeId: 'E-1', date: '2026-09-08', shiftIds: ['SHIFT-DAY'], status: 'WORK' }]
    });
  });

  it('propagates RPC errors', async () => {
    const rpc = new SupabaseMesCalendarRpc(fakeClient(new Error('permission denied')));
    await expect(rpc.saveCalendar([], [])).rejects.toThrow('permission denied');
  });
});
