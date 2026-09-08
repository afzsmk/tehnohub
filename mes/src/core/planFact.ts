import { DowntimeEvent, ProductionOrder, ProductionResult, ProductionTask } from '../types';

export interface TaskPlanFact {
  taskId: string;
  plannedQuantity: number;
  goodQuantity: number;
  scrapQuantity: number;
  completionPercent: number;
  quantityVariance: number;
  status: ProductionTask['status'];
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  scheduleVarianceMinutes?: number;
  overdue: boolean;
}

export interface OrderPlanFact {
  orderId: string;
  orderNumber: string;
  plannedQuantity: number;
  goodQuantity: number;
  scrapQuantity: number;
  completionPercent: number;
  quantityVariance: number;
  overdue: boolean;
  dueAt: string;
}

export interface PlanFactSummary {
  plannedQuantity: number;
  goodQuantity: number;
  scrapQuantity: number;
  quantityVariance: number;
  completionPercent: number;
  scrapPercent: number;
  completedTasks: number;
  activeTasks: number;
  overdueTasks: number;
  downtimeMinutes: number;
  downtimeEvents: number;
}

function percent(value: number, base: number): number {
  if (base <= 0) return 0;
  return Math.round((value / base) * 1000) / 10;
}

function minutesBetween(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) return undefined;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

function taskResultTotals(taskId: string, results: ProductionResult[]): { good: number; scrap: number } {
  return results.reduce(
    (totals, result) => result.taskId === taskId
      ? { good: totals.good + result.goodQuantity, scrap: totals.scrap + result.scrapQuantity }
      : totals,
    { good: 0, scrap: 0 }
  );
}

export function buildTaskPlanFact(tasks: ProductionTask[], results: ProductionResult[], now = new Date()): TaskPlanFact[] {
  return tasks.map(task => {
    const totals = taskResultTotals(task.id, results);
    const referenceEnd = task.actualEnd ? new Date(task.actualEnd) : now;
    const overdue = referenceEnd.getTime() > new Date(task.plannedEnd).getTime() && task.actualQuantity < task.plannedQuantity;
    return {
      taskId: task.id,
      plannedQuantity: task.plannedQuantity,
      goodQuantity: totals.good,
      scrapQuantity: totals.scrap,
      completionPercent: percent(totals.good, task.plannedQuantity),
      quantityVariance: totals.good - task.plannedQuantity,
      status: task.status,
      plannedStart: task.plannedStart,
      plannedEnd: task.plannedEnd,
      actualStart: task.actualStart,
      actualEnd: task.actualEnd,
      scheduleVarianceMinutes: task.actualEnd ? minutesBetween(task.plannedEnd, task.actualEnd) : (now.getTime() > new Date(task.plannedEnd).getTime() && task.actualQuantity < task.plannedQuantity ? minutesBetween(task.plannedEnd, now.toISOString()) : undefined),
      overdue
    };
  });
}

export function buildOrderPlanFact(orders: ProductionOrder[], tasks: ProductionTask[], results: ProductionResult[], now = new Date()): OrderPlanFact[] {
  return orders.map(order => {
    const orderTasks = tasks.filter(task => task.orderId === order.id);
    const good = orderTasks.reduce((sum, task) => sum + taskResultTotals(task.id, results).good, 0);
    const scrap = orderTasks.reduce((sum, task) => sum + taskResultTotals(task.id, results).scrap, 0);
    return {
      orderId: order.id,
      orderNumber: order.number,
      plannedQuantity: order.quantity,
      goodQuantity: good,
      scrapQuantity: scrap,
      completionPercent: percent(good, order.quantity),
      quantityVariance: good - order.quantity,
      overdue: good < order.quantity && now.getTime() > new Date(order.dueAt).getTime(),
      dueAt: order.dueAt
    };
  });
}

export function calculateDowntimeMinutes(downtimes: DowntimeEvent[], now = new Date()): number {
  return downtimes.reduce((sum, event) => {
    const start = new Date(event.startedAt).getTime();
    const end = event.endedAt ? new Date(event.endedAt).getTime() : now.getTime();
    return sum + Math.max(0, Math.round((end - start) / 60_000));
  }, 0);
}

export function buildPlanFactSummary(tasks: ProductionTask[], results: ProductionResult[], downtimes: DowntimeEvent[], now = new Date()): PlanFactSummary {
  const good = results.reduce((sum, result) => sum + result.goodQuantity, 0);
  const scrap = results.reduce((sum, result) => sum + result.scrapQuantity, 0);
  const planned = tasks.reduce((sum, task) => sum + task.plannedQuantity, 0);
  const completedTasks = tasks.filter(task => task.status === 'COMPLETED').length;
  const activeTasks = tasks.filter(task => !['COMPLETED', 'CANCELLED'].includes(task.status)).length;
  const overdueTasks = buildTaskPlanFact(tasks, results, now).filter(item => item.overdue).length;
  const totalProduced = good + scrap;
  return {
    plannedQuantity: planned,
    goodQuantity: good,
    scrapQuantity: scrap,
    quantityVariance: good - planned,
    completionPercent: percent(good, planned),
    scrapPercent: percent(scrap, totalProduced),
    completedTasks,
    activeTasks,
    overdueTasks,
    downtimeMinutes: calculateDowntimeMinutes(downtimes, now),
    downtimeEvents: downtimes.length
  };
}
