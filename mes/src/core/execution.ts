import { DowntimeEvent, ProductionEvent, ProductionResult, ProductionTask, TaskStatus } from '../types';
import { canTransition } from './taskLifecycle';

export interface ExecutionState {
  tasks: ProductionTask[];
  results: ProductionResult[];
  downtimes: DowntimeEvent[];
  events: ProductionEvent[];
}

export type ExecutionAction =
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'BLOCK'
  | 'COMPLETE'
  | 'REPORT_RESULT'
  | 'START_DOWNTIME'
  | 'END_DOWNTIME';

function nowIso(): string {
  return new Date().toISOString();
}

function eventType(action: ExecutionAction): ProductionEvent['type'] {
  switch (action) {
    case 'START': return 'TASK_STARTED';
    case 'PAUSE': return 'TASK_PAUSED';
    case 'RESUME': return 'TASK_RESUMED';
    case 'COMPLETE': return 'TASK_COMPLETED';
    case 'REPORT_RESULT': return 'RESULT_RECORDED';
    case 'START_DOWNTIME': return 'DOWNTIME_STARTED';
    case 'END_DOWNTIME': return 'DOWNTIME_ENDED';
    case 'BLOCK': return 'TASK_PAUSED';
  }
}

export function executeTaskAction(state: ExecutionState, taskId: string, action: ExecutionAction, actorId: string, at = nowIso()): ProductionTask {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`Задание не найдено: ${taskId}`);

  const target: Record<ExecutionAction, TaskStatus> = {
    START: 'RUNNING',
    PAUSE: 'PAUSED',
    RESUME: 'RUNNING',
    BLOCK: 'BLOCKED',
    COMPLETE: 'COMPLETED',
    REPORT_RESULT: task.status,
    START_DOWNTIME: task.status,
    END_DOWNTIME: task.status
  };
  const nextStatus = target[action];
  if (action !== 'REPORT_RESULT' && action !== 'START_DOWNTIME' && action !== 'END_DOWNTIME' && !canTransition(task.status, nextStatus)) {
    throw new Error(`Недопустимое действие ${action} для статуса ${task.status}`);
  }

  const timestamp = at;
  if (action === 'START') task.actualStart ??= timestamp;
  if (action === 'COMPLETE') task.actualEnd = timestamp;
  if (action === 'START' || action === 'PAUSE' || action === 'RESUME' || action === 'BLOCK' || action === 'COMPLETE') task.status = nextStatus;
  task.version += 1;

  state.events.push({
    id: `EV-${Date.now()}-${state.events.length + 1}`,
    taskId,
    type: eventType(action),
    occurredAt: timestamp,
    actorId,
    payload: { fromStatus: action === 'REPORT_RESULT' ? task.status : undefined, action }
  });
  return task;
}

export interface ResultInput {
  goodQuantity: number;
  scrapQuantity: number;
  employeeIds: string[];
  equipmentIds: string[];
  comment?: string;
}

export function recordProductionResult(state: ExecutionState, taskId: string, input: ResultInput, actorId: string, at = nowIso()): ProductionResult {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`Задание не найдено: ${taskId}`);
  if (task.status === 'CANCELLED' || task.status === 'DRAFT') throw new Error('Нельзя регистрировать факт для неактивного задания');
  if (!Number.isFinite(input.goodQuantity) || !Number.isFinite(input.scrapQuantity) || input.goodQuantity < 0 || input.scrapQuantity < 0) {
    throw new Error('Количество выпуска и брака должно быть неотрицательным числом');
  }
  if (input.goodQuantity + input.scrapQuantity <= 0) throw new Error('Нужно указать положительный результат');
  if (task.actualQuantity + input.goodQuantity > task.plannedQuantity) throw new Error('Факт выпуска превышает плановое количество');

  const result: ProductionResult = {
    id: `RES-${Date.now()}-${state.results.length + 1}`,
    taskId,
    recordedAt: at,
    goodQuantity: input.goodQuantity,
    scrapQuantity: input.scrapQuantity,
    employeeIds: [...input.employeeIds],
    equipmentIds: [...input.equipmentIds],
    comment: input.comment || undefined
  };
  state.results.push(result);
  task.actualQuantity += input.goodQuantity;
  if (task.actualQuantity >= task.plannedQuantity && canTransition(task.status, 'COMPLETED')) {
    task.status = 'COMPLETED';
    task.actualEnd ??= at;
  } else if (canTransition(task.status, 'PARTIALLY_COMPLETED')) {
    task.status = 'PARTIALLY_COMPLETED';
  }
  task.version += 1;
  state.events.push({
    id: `EV-${Date.now()}-${state.events.length + 1}`,
    taskId,
    type: 'RESULT_RECORDED',
    occurredAt: at,
    actorId,
    payload: { goodQuantity: input.goodQuantity, scrapQuantity: input.scrapQuantity }
  });
  return result;
}

export interface DowntimeInput {
  equipmentId: string;
  reasonCode: string;
  comment?: string;
}

export function startDowntime(state: ExecutionState, input: DowntimeInput, actorId: string, at = nowIso()): DowntimeEvent {
  const existing = state.downtimes.find(event => event.equipmentId === input.equipmentId && !event.endedAt);
  if (existing) throw new Error('Для оборудования уже зарегистрирован открытый простой');
  const event: DowntimeEvent = {
    id: `DT-${Date.now()}-${state.downtimes.length + 1}`,
    equipmentId: input.equipmentId,
    reasonCode: input.reasonCode,
    startedAt: at,
    comment: input.comment || undefined
  };
  state.downtimes.push(event);
  state.events.push({ id: `EV-${Date.now()}-${state.events.length + 1}`, type: 'DOWNTIME_STARTED', occurredAt: at, actorId, payload: { downtimeId: event.id, equipmentId: input.equipmentId, reasonCode: input.reasonCode } });
  return event;
}

export function endDowntime(state: ExecutionState, downtimeId: string, actorId: string, at = nowIso()): DowntimeEvent {
  const event = state.downtimes.find(item => item.id === downtimeId);
  if (!event) throw new Error(`Простой не найден: ${downtimeId}`);
  if (event.endedAt) throw new Error('Простой уже закрыт');
  event.endedAt = at;
  state.events.push({ id: `EV-${Date.now()}-${state.events.length + 1}`, type: 'DOWNTIME_ENDED', occurredAt: at, actorId, payload: { downtimeId: event.id } });
  return event;
}
