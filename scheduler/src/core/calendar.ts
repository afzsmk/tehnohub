// scheduler/src/core/calendar.ts
import { StationScheduleConfig, ShiftOverride, StationShiftSlot } from '../types';

export interface DynamicCalendarOptions {
  startDate: string;             // Начало горизонта (ГГГГ-ММ-ДД)
  daysCount: number;             // Любое число дней: 3, 7, 14, 21, 30...
  stations: StationScheduleConfig[];
  overrides?: ShiftOverride[];   // Ручные корректировки конкретных смен
}

export function generateStationCalendar(opts: DynamicCalendarOptions): StationShiftSlot[] {
  const { startDate, daysCount, stations, overrides = [] } = opts;
  const slots: StationShiftSlot[] = [];
  const start = new Date(startDate);

  const overrideMap = new Map<string, ShiftOverride>();
  overrides.forEach(ov => {
    overrideMap.set(`${ov.professionId}_${ov.date}_${ov.shiftNumber}`, ov);
  });

  for (let d = 0; d < daysCount; d++) {
    const current = new Date(start);
    current.setDate(start.getDate() + d);

    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const dayOfWeek = current.getDay();
    const isCalendarWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    stations.forEach(st => {
      const isBaseWorkingDay = checkBasePattern(st.pattern, d, dayOfWeek);
      const shiftsCount = st.shiftsPerDay || 1;

      for (let sNum: 1 | 2 = 1; sNum <= shiftsCount; (sNum as number)++) {
        const ov = overrideMap.get(`${st.professionId}_${dateStr}_${sNum}`);
        const isMaintenance = Boolean(ov?.isMaintenance);

        // Maintenance is a hard capacity block even if a manual override accidentally
        // leaves isActive=true. The slot remains visible for the operator but contributes 0 capacity.
        const isWorking = ov ? ov.isActive && !isMaintenance : isBaseWorkingDay;
        const shiftHours = ov?.shiftHours ?? (isWorking ? st.defaultShiftHours : 0);
        const workers = ov?.availableWorkers ?? (isWorking ? st.defaultWorkers : 0);

        const crew = Math.max(1, st.crewPerMachine || 1);
        const machinesByWorkers = Math.floor(workers / crew);
        const activeMachines = isWorking ? Math.min(st.totalMachines, machinesByWorkers) : 0;
        const totalCapacityHours = activeMachines * shiftHours;

        slots.push({
          professionId: st.professionId,
          professionName: st.professionName,
          date: dateStr,
          shiftNumber: sNum,
          isWorking: totalCapacityHours > 0,
          shiftHours,
          availableWorkers: workers,
          activeMachines,
          totalCapacityHours,
          isWeekend: isCalendarWeekend,
          isOverride: Boolean(ov),
          note: ov?.note
        });
      }
    });
  }

  return slots;
}

function checkBasePattern(pattern: string, dayIndex: number, dayOfWeek: number): boolean {
  switch (pattern) {
    case '2_2_12h':
      return (dayIndex % 4) < 2;
    case 'continuous_24h':
      return true;
    case '5_2_single':
    case '5_2_double':
    default:
      return dayOfWeek !== 0 && dayOfWeek !== 6;
  }
}
