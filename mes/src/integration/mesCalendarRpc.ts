import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarDay, EmployeeSchedule } from '../types';

export class SupabaseMesCalendarRpc {
  constructor(private readonly client: SupabaseClient) {}

  async saveCalendar(
    calendar: CalendarDay[],
    employeeSchedules: EmployeeSchedule[],
    expectedRevision: number
  ): Promise<number> {
    const { data, error } = await this.client.rpc('mes_save_calendar', {
      p_calendar: calendar.map(day => ({ date: day.date, isWorking: day.isWorking, shiftIds: day.shiftIds })),
      p_employee_schedules: employeeSchedules.map(item => ({
        employeeId: item.employeeId,
        date: item.date,
        shiftIds: item.shiftIds,
        status: item.status
      })),
      p_expected_revision: expectedRevision
    });
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('MES RPC mes_save_calendar вернул некорректный результат');
    }
    const revision = Number((data as Record<string, unknown>).revision);
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      throw new Error('MES RPC mes_save_calendar вернул некорректную версию');
    }
    return revision;
  }
}
