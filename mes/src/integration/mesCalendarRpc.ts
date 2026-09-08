import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarDay, EmployeeSchedule } from '../types';

export class SupabaseMesCalendarRpc {
  constructor(private readonly client: SupabaseClient) {}

  async saveCalendar(calendar: CalendarDay[], employeeSchedules: EmployeeSchedule[]): Promise<void> {
    const { error } = await this.client.rpc('mes_save_calendar', {
      p_calendar: calendar.map(day => ({ date: day.date, isWorking: day.isWorking, shiftIds: day.shiftIds })),
      p_employee_schedules: employeeSchedules.map(item => ({
        employeeId: item.employeeId,
        date: item.date,
        shiftIds: item.shiftIds,
        status: item.status
      }))
    });
    if (error) throw error;
  }
}
