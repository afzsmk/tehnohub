// scheduler/src/mes/taskStateMachine.ts
import { MesTaskStatus } from './types';

const transitions: Record<MesTaskStatus, readonly MesTaskStatus[]> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PLANNED: ['ASSIGNED', 'BLOCKED', 'CANCELLED'],
  ASSIGNED: ['READY', 'PLANNED', 'BLOCKED', 'CANCELLED'],
  READY: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['PAUSED', 'BLOCKED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['PLANNED', 'ASSIGNED', 'READY', 'RUNNING', 'CANCELLED'],
  PARTIALLY_COMPLETED: ['RUNNING', 'COMPLETED', 'BLOCKED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionTask(from: MesTaskStatus, to: MesTaskStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTaskTransition(from: MesTaskStatus, to: MesTaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`Недопустимый переход состояния задания: ${from} → ${to}`);
  }
}

export function allowedTaskTransitions(from: MesTaskStatus): MesTaskStatus[] {
  return [...transitions[from]];
}

export function isTerminalTaskStatus(status: MesTaskStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}
