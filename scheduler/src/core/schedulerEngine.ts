// scheduler/src/core/schedulerEngine.ts
import {
  ProductionOrder,
  ProductRouting,
  StationShiftSlot,
  ScheduledTask,
  StationDayLoad
} from '../types';

export interface ScheduleOptions {
  orders: ProductionOrder[];
  routings: Record<string, ProductRouting>;
  slots: StationShiftSlot[]; // Сгенерированные индивидуальные смены станков
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  dayLoads: StationDayLoad[];
  overdueOrdersCount: number;
}

export function buildSchedule(opts: ScheduleOptions): ScheduleResult {
  const { orders, routings, slots } = opts;

  // 1. Сортировка заказов: Срочные (urgent) -> по дедлайну (EDD)
  const priorityWeight = { urgent: 0, normal: 1, low: 2 };
  const sortedOrders = [...orders].sort((a, b) => {
    const pDiff = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const tasks: ScheduledTask[] = [];

  // Карта свободной емкости конкретного станка в конкретную смену: "profId_date_shift"
  const remainingHoursMap = new Map<string, number>();
  slots.forEach(s => {
    remainingHoursMap.set(`${s.professionId}_${s.date}_${s.shiftNumber}`, s.totalCapacityHours);
  });

  let overdueOrdersCount = 0;

  // 2. Раскладываем каждый заказ по станкам с учётом технологической цепочки
  sortedOrders.forEach(order => {
    const routing = routings[order.productId];
    if (!routing || !routing.steps || routing.steps.length === 0) return;

    const sortedSteps = [...routing.steps].sort((a, b) => a.stepNumber - b.stepNumber);

    // Минимальная дата, раньше которой следующая операция не может начаться
    let minStartDate = slots[0]?.date || order.dueDate;
    let minStartShift: 1 | 2 = 1;
    let isOrderLate = false;

    sortedSteps.forEach(step => {
      const operationHours = (order.quantity * step.normPerUnit) + (step.setupTimeHours || 0);
      let hoursLeft = operationHours;

      let taskStartDate = '';
      let taskStartShift: 1 | 2 = 1;
      let taskEndDate = '';
      let taskEndShift: 1 | 2 = 1;

      // Фильтруем слоты только нужного станка, упорядоченные по времени
      const stationSlots = slots.filter(s => s.professionId === step.professionId);

      for (let i = 0; i < stationSlots.length && hoursLeft > 0.01; i++) {
        const slot = stationSlots[i];

        // Проверяем технологическую зависимость: нельзя начинать раньше, чем закончился прошлый шаг
        if (slot.date < minStartDate || (slot.date === minStartDate && slot.shiftNumber < minStartShift)) {
          continue;
        }

        if (!slot.isWorking || slot.totalCapacityHours <= 0) continue;

        const key = `${step.professionId}_${slot.date}_${slot.shiftNumber}`;
        const available = remainingHoursMap.get(key) || 0;

        if (available > 0.1) {
          if (!taskStartDate) {
            taskStartDate = slot.date;
            taskStartShift = slot.shiftNumber;
          }

          const allocate = Math.min(hoursLeft, available);
          remainingHoursMap.set(key, available - allocate);
          hoursLeft -= allocate;

          taskEndDate = slot.date;
          taskEndShift = slot.shiftNumber;

          // Следующий шаг маршрута стартует не раньше завершения этого + межоперационный буфер
          minStartDate = taskEndDate;
          minStartShift = taskEndShift;
        }
      }

      // Проверка срыва дедлайна
      const finishTime = new Date(taskEndDate || minStartDate).getTime();
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
        startDate: taskStartDate || minStartDate,
        startShift: taskStartShift,
        endDate: taskEndDate || minStartDate,
        endShift: taskEndShift,
        plannedHours: Math.round(operationHours * 10) / 10,
        status: isOverdue ? 'delayed' : 'scheduled',
        isOverdue
      });
    });

    if (isOrderLate) overdueOrdersCount++;
  });

  // 3. Формируем тепловую карту загрузки оборудования
  const dayLoads = calculateHeatmap(slots, remainingHoursMap);

  return { tasks, dayLoads, overdueOrdersCount };
}

function calculateHeatmap(slots: StationShiftSlot[], remainingMap: Map<string, number>): StationDayLoad[] {
  const result: StationDayLoad[] = [];
  const grouped = new Map<string, { capacity: number; remaining: number; name: string }>();

  slots.forEach(slot => {
    const key = `${slot.professionId}_${slot.date}`;
    const cur = grouped.get(key) || { capacity: 0, remaining: 0, name: slot.professionName };
    const slotRemaining = remainingMap.get(`${slot.professionId}_${slot.date}_${slot.shiftNumber}`) ?? slot.totalCapacityHours;

    cur.capacity += slot.totalCapacityHours;
    cur.remaining += slotRemaining;
    grouped.set(key, cur);
  });

  grouped.forEach((val, key) => {
    const [profId, date] = key.split('_');
    const scheduled = Math.max(0, val.capacity - val.remaining);
    const loadPercent = val.capacity > 0 ? Math.round((scheduled / val.capacity) * 100) : 0;

    let zone: StationDayLoad['zone'] = 'empty';
    if (val.capacity === 0 || scheduled === 0) zone = 'empty';
    else if (loadPercent < 50) zone = 'low';
    else if (loadPercent <= 95) zone = 'ok';
    else if (loadPercent <= 100) zone = 'warn';
    else zone = 'danger';

    result.push({
      professionId: profId,
      professionName: val.name,
      date,
      capacityHours: Math.round(val.capacity * 10) / 10,
      scheduledHours: Math.round(scheduled * 10) / 10,
      loadPercent,
      zone
    });
  });

  return result;
}
