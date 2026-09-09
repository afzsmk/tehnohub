import { describe, expect, it } from 'vitest';
import { SupabaseMesCalendarRpc } from '../src/integration/mesCalendarRpc';

function fakeClient(response: unknown = { accepted: true, revision: 3 }, responseError: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error: responseError };
    }
  } as never;
}

describe('Supabase MES calendar RPC', () => {
  it('serializes calendar days, employee schedules and revision precondition', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesCalendarRpc(fakeClient({ accepted: true, revision: 8 }, null, (name, args) => { called = { name, args }; }));

    await expect(rpc.saveCalendar(
      [{ date: '2026-09-08', isWorking: true, shiftIds: ['SHIFT-DAY'] }],
      [{ employeeId: 'E-1', date: '2026-09-08', status: 'WORK', shiftIds: ['SHIFT-DAY'] }],
      7
    )).resolves.toBe(8);

    expect(called?.name).toBe('mes_save_calendar');
    expect(called?.args).toEqual({
      p_calendar: [{ date: '2026-09-08', isWorking: true, shiftIds: ['SHIFT-DAY'] }],
      p_employee_schedules: [{ employeeId: 'E-1', date: '2026-09-08', shiftIds: ['SHIFT-DAY'], status: 'WORK' }],
      p_expected_revision: 7
    });
  });

  it('rejects malformed revision responses', async () => {
    const rpc = new SupabaseMesCalendarRpc(fakeClient({ accepted: true, revision: 'stale' }));
    await expect(rpc.saveCalendar([], [], 1)).rejects.toThrow('некорректную версию');
  });

  it('propagates RPC errors', async () => {
    const rpc = new SupabaseMesCalendarRpc(fakeClient(undefined, new Error('Календарь устарел')));
    await expect(rpc.saveCalendar([], [], 4)).rejects.toThrow('Календарь устарел');
  });
});
