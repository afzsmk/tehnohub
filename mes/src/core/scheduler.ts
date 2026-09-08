import { Employee, Equipment, ProductionOrder, ProductionTask, RouteOperation } from '../types';

export interface ScheduleInput {
  orders: ProductionOrder[];
  employees: Employee[];
  equipment: Equipment[];
  horizonStart: string;
  horizonEnd: string;
}

export interface ScheduleConflict {
  code: 'NO_CAPACITY' | 'QUALIFICATION' | 'EQUIPMENT' | 'SEQUENCE';
  orderId: string;
  operationId: string;
  message: string;
}

export interface ScheduleOutput {
  tasks: ProductionTask[];
  conflicts: ScheduleConflict[];
}

const MINUTE = 60_000;

function nextAvailableStart(candidate: number, durationMs: number, occupied: Array<{ start: number; end: number }>): number {
  let start = candidate;
  for (const block of occupied.sort((a, b) => a.start - b.start)) {
    if (start + durationMs <= block.start) return start;
    if (start >= block.end) continue;
    start = block.end;
  }
  return start;
}

function chooseEmployee(operation: RouteOperation, employees: Employee[], from: number, to: number, used: Set<string>): string[] {
  return employees
    .filter(e => e.active)
    .filter(e => !used.has(e.id))
    .filter(e => operation.requiredQualification === undefined || e.qualificationLevel >= operation.requiredQualification)
    .slice(0, 1)
    .map(e => e.id);
}

function chooseEquipment(operation: RouteOperation, equipment: Equipment[], used: Set<string>): string[] {
  const required = operation.requiredEquipmentIds ?? [];
  if (required.length > 0) return required.filter(id => equipment.some(e => e.id === id && e.active && !used.has(e.id)));
  return equipment.filter(e => e.active && !used.has(e.id) && e.workCenter === operation.workCenter).slice(0, 1).map(e => e.id);
}

export function buildDeterministicSchedule(input: ScheduleInput): ScheduleOutput {
  const start = new Date(input.horizonStart).getTime();
  const end = new Date(input.horizonEnd).getTime();
  const employeeBusy = new Map<string, Array<{ start: number; end: number }>>();
  const equipmentBusy = new Map<string, Array<{ start: number; end: number }>>();
  const tasks: ProductionTask[] = [];
  const conflicts: ScheduleConflict[] = [];

  const orders = [...input.orders].sort((a, b) => {
    const p = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }[a.priority] - { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }[b.priority];
    return p || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  for (const order of orders) {
    let sequenceEnd = start;
    for (const operation of [...order.route].sort((a, b) => a.sequence - b.sequence)) {
      const durationMinutes = Math.max(1, Math.round(operation.setupMinutes + operation.runMinutesPerUnit * order.quantity));
      const durationMs = durationMinutes * MINUTE;
      const candidate = Math.max(sequenceEnd, start);
      if (candidate >= end) {
        conflicts.push({ code: 'NO_CAPACITY', orderId: order.id, operationId: operation.id, message: 'Операция выходит за горизонт плана.' });
        continue;
      }

      const employeePool = input.employees.filter(e => e.active && (!operation.requiredQualification || e.qualificationLevel >= operation.requiredQualification));
      if (employeePool.length === 0) {
        conflicts.push({ code: 'QUALIFICATION', orderId: order.id, operationId: operation.id, message: 'Нет сотрудника требуемой квалификации.' });
        continue;
      }

      const equipmentPool = input.equipment.filter(e => e.active && (!operation.requiredEquipmentIds?.length || operation.requiredEquipmentIds.includes(e.id)) && (!operation.requiredEquipmentIds?.length ? e.workCenter === operation.workCenter : true));
      if (equipmentPool.length === 0) {
        conflicts.push({ code: 'EQUIPMENT', orderId: order.id, operationId: operation.id, message: 'Нет доступного оборудования для операции.' });
        continue;
      }

      const employee = employeePool.find(e => {
        const busy = employeeBusy.get(e.id) ?? [];
        return nextAvailableStart(candidate, durationMs, busy) + durationMs <= end;
      });
      const machine = equipmentPool.find(e => {
        const busy = equipmentBusy.get(e.id) ?? [];
        return nextAvailableStart(candidate, durationMs, busy) + durationMs <= end;
      });

      if (!employee || !machine) {
        conflicts.push({ code: 'NO_CAPACITY', orderId: order.id, operationId: operation.id, message: 'Нет совместного окна сотрудника и оборудования.' });
        continue;
      }

      const employeeBusyBlocks = employeeBusy.get(employee.id) ?? [];
      const machineBusyBlocks = equipmentBusy.get(machine.id) ?? [];
      let plannedStart = nextAvailableStart(candidate, durationMs, employeeBusyBlocks);
      plannedStart = nextAvailableStart(plannedStart, durationMs, machineBusyBlocks);
      const plannedEnd = plannedStart + durationMs;
      if (plannedEnd > end) {
        conflicts.push({ code: 'NO_CAPACITY', orderId: order.id, operationId: operation.id, message: 'Операция не помещается в горизонт.' });
        continue;
      }

      employeeBusy.set(employee.id, [...employeeBusyBlocks, { start: plannedStart, end: plannedEnd }]);
      equipmentBusy.set(machine.id, [...machineBusyBlocks, { start: plannedStart, end: plannedEnd }]);
      sequenceEnd = plannedEnd;

      tasks.push({
        id: `${order.id}:${operation.id}:v1`,
        orderId: order.id,
        operationId: operation.id,
        operationSequence: operation.sequence,
        status: 'PLANNED',
        plannedStart: new Date(plannedStart).toISOString(),
        plannedEnd: new Date(plannedEnd).toISOString(),
        plannedQuantity: order.quantity,
        actualQuantity: 0,
        assignedEmployeeIds: chooseEmployee(operation, [employee], plannedStart, plannedEnd, new Set()),
        assignedEquipmentIds: chooseEquipment(operation, [machine], new Set()),
        version: 1
      });
    }
  }

  return { tasks, conflicts };
}
