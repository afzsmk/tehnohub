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

  // Быстрый поиск переопределений по ключу "stationId_date_shift"
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

    const dayOfWeek = current.getDay(); // 0 = ВС, 6 = СБ
    const isCalendarWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    stations.forEach(st => {
      // Определяем, работает ли станок по своему базовому шаблону
      const isBaseWorkingDay = checkBasePattern(st.pattern, d, dayOfWeek);
      const shiftsCount = st.shiftsPerDay || 1;

      for (let sNum: 1 | 2 = 1; sNum <= shiftsCount; (sNum as number)++) {
        const ovKey = `${st.professionId}_${dateStr}_${sNum}`;
        const ov = overrideMap.get(ovKey);

        // Ручное переопределение имеет абсолютный приоритет над базовым шаблоном!
        const isWorking = ov ? ov.isActive : isBaseWorkingDay;
        const shiftHours = ov?.shiftHours ?? (isWorking ? st.defaultShiftHours : 0);
        const workers = ov?.availableWorkers ?? (isWorking ? st.defaultWorkers : 0);

        // Расчет реально работающих станков на основе доступных людей:
        // Если станок требует звено 2 чел, а вышло 3 чел — работать может только 1 станок (1 лишний или на подхвате)
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

// Проверка базового паттерна сменности
function checkBasePattern(pattern: string, dayIndex: number, dayOfWeek: number): boolean {
  switch (pattern) {
    case '2_2_12h':
      // Цикл 2 дня работы, 2 дня отдыха (не зависит от дней недели!)
      return (dayIndex % 4) < 2;
    case 'continuous_24h':
      // Непрерывный цикл (работает каждый день)
      return true;
    case '5_2_single':
    case '5_2_double':
    default:
      // Классическая пятидневка: ПН-ПТ работаем, СБ-ВС отдых
      return dayOfWeek !== 0 && dayOfWeek !== 6;
  }
}
