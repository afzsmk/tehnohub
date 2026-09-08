import { DowntimeEvent, ProductionEvent, ProductionResult, ProductionTask, TaskStatus } from '../types';
import { canTransition } from './taskLifecycle';

export interface ExecutionState {
  tasks: ProductionTask[];
  results: ProductionResult[];
  downtimes: DowntimeEvent[];
  events: ProductionEvent[];
}

export type ExecutionAction =
  | 'PREPARE'
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'BLOCK'
  | 'COMPLETE';

function nowIso(): string {
  return new Date().toISOString();
}

function eventType(action: ExecutionAction): ProductionEvent['type'] {
  switch (action) {
    case 'START': return 'TASK_STARTED';
    case 'PAUSE': return 'TASK_PAUSED';
    case 'RESUME': return 'TASK_RESUMED';
    case 'COMPLETE': return 'TASK_COMPLETED';
    case 'BLOCK': return 'TASK_PAUSED';
    case 'PREPARE': return 'TASK_STARTED';
  }
}

export function executeTaskAction(state: ExecutionState, taskId: string, action: ExecutionAction, actorId: string, at = nowIso()): ProductionTask {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`Задание не найдено: ${taskId}`);

  if (action === 'PREPARE') {
    const next = task.status === 'PLANNED' ? 'ASSIGNED' : task.status === 'ASSIGNED' ? 'READY' : task.status;
    if (next === task.status) throw new Error(`Задание уже подготовлено: ${task.status}`);
    if (!canTransition(task.status, next)) throw new Error(`Недопустимая подготовка: ${task.status}`);
    task.status = next;
  } else {
    const target: Record<Exclude<ExecutionAction, 'PREPARE'>, TaskStatus> = {
      START: 'RUNNING',
      PAUSE: 'PAUSED',
      RESUME: 'RUNNING',
      BLOCK: 'BLOCKED',
      COMPLETE: 'COMPLETED'
    };
    const nextStatus = target[action];
    if (!canTransition(task.status, nextStatus)) throw new Error(`Недопустимое действие ${action} для статуса ${task.status}`);
    if (action === 'START') task.actualStart ??= at;
    if (action === 'COMPLETE') task.actualEnd = at;
    task.status = nextStatus;
  }

  task.version += 1;
  state.events.push({
    id: `EV-${Date.now()}-${state.events.length + 1}`,
    taskId,
    type: eventType(action),
    occurredAt: at,
    actorId,
    payload: { action, status: task.status }
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
    payload: { resultId: result.id, goodQuantity: input.goodQuantity, scrapQuantity: input.scrapQuantity }
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
