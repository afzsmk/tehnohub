// scheduler/src/core/schedulerEngine.ts
import {
  ProductionOrder,
  ProductRouting,
  ShiftSlot,
  ScheduledTask,
  StationDayLoad
} from '../types';

export interface StationCapacity {
  machinesCount: number; // Количество станков на участке (например: AluRanger = 3)
}

export interface ScheduleOptions {
  orders: ProductionOrder[];
  routings: Record<string, ProductRouting>; // Маршруты по productId
  calendarSlots: ShiftSlot[];
  stationCapacities: Record<string, StationCapacity>; // Доступность оборудования по professionId
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  dayLoads: StationDayLoad[];
  overdueOrdersCount: number;
}

export function buildSchedule(opts: ScheduleOptions): ScheduleResult {
  const { orders, routings, calendarSlots, stationCapacities } = opts;

  // 1. Сортируем заказы: сначала Срочные ('urgent'), затем по ближайшему дедлайну (EDD)
  const priorityWeight = { urgent: 0, normal: 1, low: 2 };
  const sortedOrders = [...orders].sort((a, b) => {
    const pDiff = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const tasks: ScheduledTask[] = [];

  // Карта занятости станков: ключ "professionId_date_shift", значение — остаток свободных часов
  const remainingHoursMap = new Map<string, number>();

  calendarSlots.forEach(slot => {
    Object.keys(stationCapacities).forEach(profId => {
      const machines = stationCapacities[profId]?.machinesCount || 1;
      const totalShiftCapacity = slot.durationHours * machines;
      const key = `${profId}_${slot.date}_${slot.shiftNumber}`;
      remainingHoursMap.set(key, totalShiftCapacity);
    });
  });

  let overdueOrdersCount = 0;

  // 2. Раскладываем каждый заказ по цепочке его технологического маршрута
  sortedOrders.forEach(order => {
    const routing = routings[order.productId];
    if (!routing || !routing.steps || routing.steps.length === 0) return;

    // Сортируем шаги по порядку: Шаг 10 -> Шаг 20 -> Шаг 30
    const sortedSteps = [...routing.steps].sort((a, b) => a.stepNumber - b.stepNumber);

    let earliestSlotIndex = 0;
    let isOrderLate = false;

    sortedSteps.forEach(step => {
      // Трудоемкость операции: объем * норма + время переналадки Тпз
      const operationHours = (order.quantity * step.normPerUnit) + (step.setupTimeHours || 0);
      let hoursLeftToSchedule = operationHours;

      let taskStartDate = '';
      let taskStartShift: 1 | 2 = 1;
      let taskEndDate = '';
      let taskEndShift: 1 | 2 = 1;

      // Ищем свободные смены на целевом станке, начиная с допустимого момента
      for (let sIdx = earliestSlotIndex; sIdx < calendarSlots.length && hoursLeftToSchedule > 0.01; sIdx++) {
        const slot = calendarSlots[sIdx];
        if (slot.isWeekend || slot.isMaintenance || slot.durationHours <= 0) continue;

        const key = `${step.professionId}_${slot.date}_${slot.shiftNumber}`;
        const available = remainingHoursMap.get(key) || 0;

        if (available > 0.1) {
          if (!taskStartDate) {
            taskStartDate = slot.date;
            taskStartShift = slot.shiftNumber;
          }

          const allocate = Math.min(hoursLeftToSchedule, available);
          remainingHoursMap.set(key, available - allocate);
          hoursLeftToSchedule -= allocate;

          taskEndDate = slot.date;
          taskEndShift = slot.shiftNumber;

          // Следующий шаг маршрута не может начаться раньше завершения текущего
          earliestSlotIndex = sIdx;
        }
      }

      // Проверка дедлайна сдачи
      const finishTime = new Date(taskEndDate).getTime();
      const dueTime = new Date(order.dueDate).getTime();
      const isOverdue = finishTime > dueTime;
      if (isOverdue) isOrderLate = true;

      tasks.push({
        id: `task_${order.id}_${step.stepNumber}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customer: order.customer,
        productId: order.productId,
        productName: order.productName,
        stepNumber: step.stepNumber,
        professionId: step.professionId,
        professionName: step.professionName,
        quantity: order.quantity,
        unit: order.unit,
        startDate: taskStartDate || order.dueDate,
        startShift: taskStartShift,
        endDate: taskEndDate || order.dueDate,
        endShift: taskEndShift,
        plannedHours: Math.round(operationHours * 10) / 10,
        status: isOverdue ? 'delayed' : 'scheduled',
        isOverdue
      });
    });

    if (isOrderLate) overdueOrdersCount++;
  });

  // 3. Вычисляем суточную загрузку для тепловой карты
  const dayLoads = calculateHeatmapLoads(calendarSlots, stationCapacities, remainingHoursMap);

  return { tasks, dayLoads, overdueOrdersCount };
}

function calculateHeatmapLoads(
  slots: ShiftSlot[],
  capacities: Record<string, StationCapacity>,
  remainingMap: Map<string, number>
): StationDayLoad[] {
  const result: StationDayLoad[] = [];
  const uniqueDates = Array.from(new Set(slots.map(s => s.date)));

  Object.keys(capacities).forEach(profId => {
    const machines = capacities[profId]?.machinesCount || 1;

    uniqueDates.forEach(date => {
      const daySlots = slots.filter(s => s.date === date);
      let dayCapacity = 0;
      let dayRemaining = 0;

      daySlots.forEach(slot => {
        const key = `${profId}_${slot.date}_${slot.shiftNumber}`;
        const slotCap = slot.durationHours * machines;
        dayCapacity += slotCap;
        dayRemaining += (remainingMap.get(key) ?? slotCap);
      });

      const scheduled = Math.max(0, dayCapacity - dayRemaining);
      const loadPercent = dayCapacity > 0 ? Math.round((scheduled / dayCapacity) * 100) : 0;

      let zone: StationDayLoad['zone'] = 'empty';
      if (dayCapacity === 0 || scheduled === 0) zone = 'empty';
      else if (loadPercent < 50) zone = 'low';
      else if (loadPercent <= 95) zone = 'ok';
      else if (loadPercent <= 100) zone = 'warn';
      else zone = 'danger';

      result.push({
        professionId: profId,
        professionName: profId,
        date,
        capacityHours: dayCapacity,
        scheduledHours: Math.round(scheduled * 10) / 10,
        loadPercent,
        zone
      });
    });
  });

  return result;
}
