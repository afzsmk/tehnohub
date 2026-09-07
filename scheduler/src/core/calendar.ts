// scheduler/src/core/calendar.ts
import { ShiftSlot } from '../types';

export interface CalendarConfig {
  startDate: string;         // Начальная дата (ГГГГ-ММ-ДД)
  daysCount: number;         // Горизонт (14, 21, 30 дней)
  shiftsPerDay: 1 | 2;       // 1 или 2 смены в день
  shiftHours: number;        // Длина смены (8ч, 11ч, 12ч)
  workOnWeekends?: boolean;  // Работать ли по субботам
}

export function generateShiftCalendar(cfg: CalendarConfig): ShiftSlot[] {
  const slots: ShiftSlot[] = [];
  const start = new Date(cfg.startDate);

  for (let d = 0; d < cfg.daysCount; d++) {
    const current = new Date(start);
    current.setDate(start.getDate() + d);

    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const dayOfWeek = current.getDay(); // 0 = ВС, 6 = СБ
    const isWeekend = dayOfWeek === 0 || (!cfg.workOnWeekends && dayOfWeek === 6);

    // Смена 1 (Дневная)
    slots.push({
      date: dateStr,
      shiftNumber: 1,
      durationHours: isWeekend ? 0 : cfg.shiftHours,
      isWeekend,
      isMaintenance: false
    });

    // Смена 2 (Вечерняя, если включена)
    if (cfg.shiftsPerDay === 2) {
      slots.push({
        date: dateStr,
        shiftNumber: 2,
        durationHours: isWeekend ? 0 : cfg.shiftHours,
        isWeekend,
        isMaintenance: false
      });
    }
  }

  return slots;
}
