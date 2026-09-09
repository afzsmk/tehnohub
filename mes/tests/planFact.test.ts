import { describe, expect, it } from 'vitest';
import { buildOrderPlanFact, buildPlanFactSummary, buildTaskPlanFact, calculateDowntimeMinutes } from '../src/core/planFact';
import { DowntimeEvent, ProductionOrder, ProductionResult, ProductionTask } from '../src/types';

const task: ProductionTask = {
  id: 'T1', orderId: 'O1', operationId: 'OP1', operationSequence: 10, status: 'PARTIALLY_COMPLETED',
  plannedStart: '2030-01-01T08:00:00.000Z', plannedEnd: '2030-01-01T10:00:00.000Z',
  actualStart: '2030-01-01T08:05:00.000Z', plannedQuantity: 100, actualQuantity: 60,
  assignedEmployeeIds: ['E1'], assignedEquipmentIds: ['EQ1'], version: 2
};
const order: ProductionOrder = {
  id: 'O1', number: 'ZK-1', productId: 'P1', quantity: 100, completedQuantity: 0,
  dueAt: '2030-01-01T12:00:00.000Z', priority: 'HIGH', status: 'IN_EXECUTION', route: []
};
const results: ProductionResult[] = [
  { id: 'R1', taskId: 'T1', recordedAt: '2030-01-01T09:00:00.000Z', goodQuantity: 60, scrapQuantity: 5, employeeIds: ['E1'], equipmentIds: ['EQ1'] }
];

describe('MES plan-fact analytics', () => {
  it('calculates task completion and variance', () => {
    const rows = buildTaskPlanFact([task], results, new Date('2030-01-01T09:30:00.000Z'));
    expect(rows[0].goodQuantity).toBe(60);
    expect(rows[0].scrapQuantity).toBe(5);
    expect(rows[0].completionPercent).toBe(60);
    expect(rows[0].quantityVariance).toBe(-40);
    expect(rows[0].overdue).toBe(false);
  });

  it('marks an unfinished task overdue after planned end', () => {
    const rows = buildTaskPlanFact([task], results, new Date('2030-01-01T11:00:00.000Z'));
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].scheduleVarianceMinutes).toBe(60);
  });

  it('aggregates order fact from task results', () => {
    const rows = buildOrderPlanFact([order], [task], results, new Date('2030-01-01T11:00:00.000Z'));
    expect(rows[0].goodQuantity).toBe(60);
    expect(rows[0].scrapQuantity).toBe(5);
    expect(rows[0].completionPercent).toBe(60);
    expect(rows[0].overdue).toBe(false);
  });

  it('calculates open and closed downtime duration', () => {
    const downtimes: DowntimeEvent[] = [
      { id: 'D1', equipmentId: 'EQ1', reasonCode: 'BREAKDOWN', startedAt: '2030-01-01T08:00:00.000Z', endedAt: '2030-01-01T08:20:00.000Z' },
      { id: 'D2', equipmentId: 'EQ1', reasonCode: 'MATERIAL', startedAt: '2030-01-01T09:00:00.000Z' }
    ];
    expect(calculateDowntimeMinutes(downtimes, new Date('2030-01-01T09:15:00.000Z'))).toBe(35);
  });

  it('builds a summary with scrap and active-task metrics', () => {
    const summary = buildPlanFactSummary([task], results, [], new Date('2030-01-01T09:30:00.000Z'));
    expect(summary.plannedQuantity).toBe(100);
    expect(summary.goodQuantity).toBe(60);
    expect(summary.scrapQuantity).toBe(5);
    expect(summary.completionPercent).toBe(60);
    expect(summary.scrapPercent).toBeCloseTo(7.7, 1);
    expect(summary.completedTasks).toBe(0);
    expect(summary.activeTasks).toBe(1);
  });
});
