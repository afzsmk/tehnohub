import { TaskStatus } from '../types';

const transitions: Record<TaskStatus, TaskStatus[]> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PLANNED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['READY', 'PLANNED', 'CANCELLED'],
  READY: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['PAUSED', 'BLOCKED', 'PARTIALLY_COMPLETED', 'COMPLETED'],
  PAUSED: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['READY', 'ASSIGNED', 'CANCELLED'],
  PARTIALLY_COMPLETED: ['RUNNING', 'COMPLETED', 'BLOCKED'],
  COMPLETED: [],
  CANCELLED: []
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionTask(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Недопустимый переход задания: ${from} -> ${to}`);
  }
  return to;
}

export function allowedTransitions(from: TaskStatus): TaskStatus[] {
  return [...transitions[from]];
}
