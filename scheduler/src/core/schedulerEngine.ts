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
  slots: StationShiftSlot[];
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  dayLoads: StationDayLoad[];
  overdueOrdersCount: number;
}

function isSlotBefore(slot: StationShiftSlot, date: string, shift: 1 | 2): boolean {
  return slot.date < date || (slot.date === date && slot.shiftNumber < shift);
}

function addInterOperationBuffer(
  slots: StationShiftSlot[],
  professionId: string,
  endDate: string,
  endShift: 1 | 2,
  bufferHours: number,
): { date: string; shift: 1 | 2 } {
  if (bufferHours <= 0) return { date: endDate, shift: endShift };

  // The current scheduler has day/shift granularity, not intra-shift timestamps.
  // Apply the buffer conservatively by consuming complete future shift capacities.
  const stationSlots = slots.filter(s => s.professionId === professionId);
  const endIndex = stationSlots.findIndex(s => s.date === endDate && s.shiftNumber === endShift);
  if (endIndex < 0) return { date: endDate, shift: endShift };

  let remaining = bufferHours;
  for (let i = endIndex + 1; i < stationSlots.length; i++) {
    const slot = stationSlots[i];
    if (!slot.isWorking || slot.totalCapacityHours <= 0) continue;
    remaining -= slot.shiftHours;
    if (remaining <= 0) {
      return { date: slot.date, shift: slot.shiftNumber };
    }
  }

  return { date: endDate, shift: endShift };
}

export function buildSchedule(opts: ScheduleOptions): ScheduleResult {
  const { orders, routings, slots } = opts;
  const priorityWeight = { urgent: 0, normal: 1, low: 2 };
  const sortedOrders = [...orders].sort((a, b) => {
    const pDiff = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const tasks: ScheduledTask[] = [];
  const remainingHoursMap = new Map<string, number>();
  slots.forEach(s => remainingHoursMap.set(`${s.professionId}_${s.date}_${s.shiftNumber}`, s.totalCapacityHours));

  let overdueOrdersCount = 0;

  sortedOrders.forEach(order => {
    const routing = routings[order.productId];
    if (!routing?.steps?.length) return;

    const sortedSteps = [...routing.steps].sort((a, b) => a.stepNumber - b.stepNumber);
    let minStartDate = slots[0]?.date || order.dueDate;
    let minStartShift: 1 | 2 = 1;
    let isOrderLate = false;

    sortedSteps.forEach((step, stepIndex) => {
      const operationHours = (order.quantity * step.normPerUnit) + (step.setupTimeHours || 0);
      let hoursLeft = operationHours;
      let taskStartDate = '';
      let taskStartShift: 1 | 2 = 1;
      let taskEndDate = '';
      let taskEndShift: 1 | 2 = 1;

      const stationSlots = slots.filter(s => s.professionId === step.professionId);
      for (const slot of stationSlots) {
        if (isSlotBefore(slot, minStartDate, minStartShift)) continue;
        if (!slot.isWorking || slot.totalCapacityHours <= 0) continue;

        const key = `${step.professionId}_${slot.date}_${slot.shiftNumber}`;
        const available = remainingHoursMap.get(key) || 0;
        if (available <= 0.1) continue;

        if (!taskStartDate) {
          taskStartDate = slot.date;
          taskStartShift = slot.shiftNumber;
        }

        const allocate = Math.min(hoursLeft, available);
        remainingHoursMap.set(key, available - allocate);
        hoursLeft -= allocate;
        taskEndDate = slot.date;
        taskEndShift = slot.shiftNumber;

        if (hoursLeft <= 0.01) break;
      }

      const effectiveEndDate = taskEndDate || minStartDate;
      const effectiveEndShift = taskEndDate ? taskEndShift : minStartShift;
      const buffer = step.bufferHoursAfter || 0;
      const nextStart = addInterOperationBuffer(
        slots,
        step.professionId,
        effectiveEndDate,
        effectiveEndShift,
        buffer,
      );

      // A positive buffer always advances the next operation beyond the finished slot.
      // With zero buffer the next routing step may use the next station's earliest slot on/after the finish point.
      minStartDate = buffer > 0 ? nextStart.date : effectiveEndDate;
      minStartShift = buffer > 0 ? nextStart.shift : effectiveEndShift;

      const finishTime = new Date(effectiveEndDate).getTime();
      const dueTime = new Date(order.dueDate).getTime();
      const isOverdue = finishTime > dueTime || hoursLeft > 0.01;
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
        endDate: effectiveEndDate,
        endShift: effectiveEndShift,
        plannedHours: Math.round(operationHours * 10) / 10,
        status: isOverdue ? 'delayed' : 'scheduled',
        isOverdue
      });

      if (stepIndex === sortedSteps.length - 1) {
        // no-op: terminal step keeps its own completion information above
      }
    });

    if (isOrderLate) overdueOrdersCount++;
  });

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
    const separatorIndex = key.lastIndexOf('_');
    const profId = key.slice(0, separatorIndex);
    const date = key.slice(separatorIndex + 1);
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
