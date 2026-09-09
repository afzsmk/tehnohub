import { describe, expect, it } from 'vitest';
import { applyReplanProposal, buildReplanProposal } from '../src/core/replanning';
import { DowntimeEvent, ProductionTask } from '../src/types';

function makeTask(id: string, start: string, end: string, status: ProductionTask['status'] = 'READY'): ProductionTask {
  return {
    id,
    orderId: id,
    operationId: `${id}-OP`,
    operationSequence: 10,
    status,
    plannedStart: start,
    plannedEnd: end,
    plannedQuantity: 10,
    actualQuantity: 0,
    assignedEmployeeIds: ['E1'],
    assignedEquipmentIds: ['EQ1'],
    version: 1
  };
}

describe('MES operational replanning', () => {
  it('moves a task out of equipment downtime', () => {
    const tasks = [makeTask('T1', '2030-01-01T08:00:00.000Z', '2030-01-01T10:00:00.000Z')];
    const downtimes: DowntimeEvent[] = [{ id: 'D1', equipmentId: 'EQ1', reasonCode: 'BREAKDOWN', startedAt: '2030-01-01T09:00:00.000Z', endedAt: '2030-01-01T11:00:00.000Z' }];
    const proposal = buildReplanProposal(tasks, downtimes, '2030-01-02T00:00:00.000Z', new Date('2030-01-01T08:00:00.000Z'));
    expect(proposal.changes[0].proposedStart).toBe('2030-01-01T11:00:00.000Z');
    const applied = applyReplanProposal(tasks, proposal);
    expect(applied[0].plannedStart).toBe('2030-01-01T11:00:00.000Z');
    expect(applied[0].version).toBe(2);
  });

  it('cascades a delay to a following task sharing the resource', () => {
    const tasks = [
      makeTask('T1', '2030-01-01T08:00:00.000Z', '2030-01-01T10:00:00.000Z'),
      makeTask('T2', '2030-01-01T10:00:00.000Z', '2030-01-01T12:00:00.000Z')
    ];
    const downtimes: DowntimeEvent[] = [{ id: 'D1', equipmentId: 'EQ1', reasonCode: 'BREAKDOWN', startedAt: '2030-01-01T09:00:00.000Z', endedAt: '2030-01-01T11:00:00.000Z' }];
    const proposal = buildReplanProposal(tasks, downtimes, '2030-01-02T00:00:00.000Z', new Date('2030-01-01T08:00:00.000Z'));
    expect(proposal.changes.map(c => c.taskId)).toEqual(['T1', 'T2']);
    expect(proposal.changes[1].proposedStart).toBe('2030-01-01T13:00:00.000Z');
  });

  it('does not move completed tasks', () => {
    const task = makeTask('T1', '2030-01-01T08:00:00.000Z', '2030-01-01T10:00:00.000Z', 'COMPLETED');
    const downtime: DowntimeEvent = { id: 'D1', equipmentId: 'EQ1', reasonCode: 'BREAKDOWN', startedAt: '2030-01-01T09:00:00.000Z', endedAt: '2030-01-01T11:00:00.000Z' };
    const proposal = buildReplanProposal([task], [downtime], '2030-01-02T00:00:00.000Z', new Date('2030-01-01T08:00:00.000Z'));
    expect(proposal.changes).toHaveLength(0);
    expect(applyReplanProposal([task], proposal)[0].version).toBe(1);
  });

  it('reports tasks that no longer fit the horizon', () => {
    const task = makeTask('T1', '2030-01-01T22:00:00.000Z', '2030-01-01T23:30:00.000Z');
    const downtime: DowntimeEvent = { id: 'D1', equipmentId: 'EQ1', reasonCode: 'BREAKDOWN', startedAt: '2030-01-01T21:00:00.000Z', endedAt: '2030-01-02T01:00:00.000Z' };
    const proposal = buildReplanProposal([task], [downtime], '2030-01-02T02:00:00.000Z', new Date('2030-01-01T22:00:00.000Z'));
    expect(proposal.blockedTaskIds).toContain('T1');
    expect(proposal.changes).toHaveLength(0);
  });
});
