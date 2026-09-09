import { DowntimeEvent, ProductionTask, TaskStatus } from '../types';

export interface ReplanChange {
  taskId: string;
  originalStart: string;
  originalEnd: string;
  proposedStart: string;
  proposedEnd: string;
  delayMinutes: number;
  reason: 'DOWNTIME' | 'RESOURCE_CASCADE';
}

export interface ReplanProposal {
  createdAt: string;
  horizonEnd: string;
  changes: ReplanChange[];
  blockedTaskIds: string[];
}

const MOVABLE_STATUSES: TaskStatus[] = ['PLANNED', 'ASSIGNED', 'READY'];
const MINUTE = 60_000;

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}

function isMovable(task: ProductionTask): boolean {
  return MOVABLE_STATUSES.includes(task.status);
}

function cloneTime(task: ProductionTask, start: number): ReplanChange {
  const originalStart = new Date(task.plannedStart).getTime();
  const originalEnd = new Date(task.plannedEnd).getTime();
  const duration = Math.max(MINUTE, originalEnd - originalStart);
  const delayMinutes = Math.max(0, Math.round((start - originalStart) / MINUTE));
  return {
    taskId: task.id,
    originalStart: task.plannedStart,
    originalEnd: task.plannedEnd,
    proposedStart: new Date(start).toISOString(),
    proposedEnd: new Date(start + duration).toISOString(),
    delayMinutes,
    reason: 'DOWNTIME'
  };
}

export function buildReplanProposal(
  tasks: ProductionTask[],
  downtimes: DowntimeEvent[],
  horizonEnd: string,
  now = new Date()
): ReplanProposal {
  const movable = tasks.filter(isMovable);
  const proposedStart = new Map<string, number>();
  const proposedEnd = new Map<string, number>();
  const reason = new Map<string, ReplanChange['reason']>();
  const blockedTaskIds: string[] = [];
  const horizon = new Date(horizonEnd).getTime();

  for (const task of movable) {
    const taskStart = new Date(task.plannedStart).getTime();
    const taskEnd = new Date(task.plannedEnd).getTime();
    const resourceDowntimes = downtimes.filter(d => d.equipmentId && task.assignedEquipmentIds.includes(d.equipmentId));
    let start = taskStart;
    for (const downtime of resourceDowntimes) {
      const downtimeStart = new Date(downtime.startedAt).getTime();
      const downtimeEnd = downtime.endedAt ? new Date(downtime.endedAt).getTime() : now.getTime();
      if (overlaps(start, taskEnd + Math.max(0, start - taskStart), downtimeStart, downtimeEnd)) {
        start = Math.max(start, downtimeEnd);
        reason.set(task.id, 'DOWNTIME');
      }
    }
    proposedStart.set(task.id, start);
    proposedEnd.set(task.id, start + Math.max(MINUTE, taskEnd - taskStart));
  }

  const sorted = [...movable].sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());
  for (const task of sorted) {
    let start = proposedStart.get(task.id) ?? new Date(task.plannedStart).getTime();
    const resources = new Set([...task.assignedEmployeeIds, ...task.assignedEquipmentIds]);
    for (const previous of sorted) {
      if (previous.id === task.id) continue;
      const previousOriginalStart = new Date(previous.plannedStart).getTime();
      const taskOriginalStart = new Date(task.plannedStart).getTime();
      if (previousOriginalStart > taskOriginalStart) continue;
      const previousResources = new Set([...previous.assignedEmployeeIds, ...previous.assignedEquipmentIds]);
      const sharesResource = [...resources].some(resource => previousResources.has(resource));
      if (!sharesResource) continue;
      const previousEnd = proposedEnd.get(previous.id) ?? new Date(previous.plannedEnd).getTime();
      if (previousEnd > start) {
        start = previousEnd;
        if (!reason.has(task.id)) reason.set(task.id, 'RESOURCE_CASCADE');
      }
    }
    proposedStart.set(task.id, start);
    proposedEnd.set(task.id, start + Math.max(MINUTE, new Date(task.plannedEnd).getTime() - new Date(task.plannedStart).getTime()));
  }

  const changes: ReplanChange[] = [];
  for (const task of movable) {
    const start = proposedStart.get(task.id) ?? new Date(task.plannedStart).getTime();
    const end = proposedEnd.get(task.id) ?? new Date(task.plannedEnd).getTime();
    if (end > horizon) {
      blockedTaskIds.push(task.id);
      continue;
    }
    if (start > new Date(task.plannedStart).getTime()) {
      const change = cloneTime(task, start);
      change.proposedEnd = new Date(end).toISOString();
      change.reason = reason.get(task.id) ?? 'RESOURCE_CASCADE';
      changes.push(change);
    }
  }

  return { createdAt: now.toISOString(), horizonEnd, changes, blockedTaskIds };
}

export function applyReplanProposal(tasks: ProductionTask[], proposal: ReplanProposal): ProductionTask[] {
  const byTaskId = new Map(proposal.changes.map(change => [change.taskId, change]));
  return tasks.map(task => {
    const change = byTaskId.get(task.id);
    if (!change || !isMovable(task)) return task;
    return {
      ...task,
      plannedStart: change.proposedStart,
      plannedEnd: change.proposedEnd,
      version: task.version + 1
    };
  });
}
