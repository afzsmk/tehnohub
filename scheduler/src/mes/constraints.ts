// scheduler/src/mes/constraints.ts
import { MesEquipment, MesEmployee, MesMaintenanceOrder, MesProductionTask } from './types';

export interface TaskConstraintContext {
  equipment?: MesEquipment;
  equipmentBlocked?: boolean;
  employees: MesEmployee[];
  requiredEmployeeIds?: string[];
  plannedTasks: MesProductionTask[];
  existingTaskId?: string;
}

export function validateTaskHardConstraints(
  task: MesProductionTask,
  context: TaskConstraintContext,
): string[] {
  const errors: string[] = [];

  if (new Date(task.plannedEnd).getTime() <= new Date(task.plannedStart).getTime()) {
    errors.push('plannedEnd должен быть позже plannedStart');
  }

  if (task.quantity < 0 || !Number.isFinite(task.quantity)) {
    errors.push('Количество задания должно быть неотрицательным числом');
  }

  if (task.plannedHours <= 0 || !Number.isFinite(task.plannedHours)) {
    errors.push('plannedHours должно быть положительным числом');
  }

  if (context.equipmentBlocked) {
    errors.push('Оборудование заблокировано ремонтом или ограничением доступности');
  }

  const activeEmployees = new Set(context.employees.filter(e => e.active).map(e => e.id));
  for (const employeeId of context.requiredEmployeeIds || []) {
    if (!activeEmployees.has(employeeId)) {
      errors.push(`Сотрудник ${employeeId} недоступен или неактивен`);
    }
  }

  const start = new Date(task.plannedStart).getTime();
  const end = new Date(task.plannedEnd).getTime();
  const overlaps = context.plannedTasks.some(other => {
    if (other.id === context.existingTaskId || other.id === task.id) return false;
    if (other.status === 'CANCELLED' || other.status === 'COMPLETED') return false;
    if (other.id === task.id) return false;
    if (other.professionId !== task.professionId) return false;
    const otherStart = new Date(other.plannedStart).getTime();
    const otherEnd = new Date(other.plannedEnd).getTime();
    return start < otherEnd && end > otherStart;
  });

  if (overlaps) errors.push('Задание пересекается с другим незавершённым заданием на том же участке');

  return errors;
}

export function isEquipmentBlocked(
  equipmentId: string,
  whenStart: string,
  whenEnd: string,
  maintenanceOrders: MesMaintenanceOrder[],
): boolean {
  const start = new Date(whenStart).getTime();
  const end = new Date(whenEnd).getTime();
  return maintenanceOrders.some(order => {
    if (order.equipmentId !== equipmentId || order.status === 'CANCELLED') return false;
    const blockStart = new Date(order.actualStart || order.plannedStart).getTime();
    const blockEnd = new Date(order.actualEnd || order.plannedEnd).getTime();
    return start < blockEnd && end > blockStart;
  });
}
