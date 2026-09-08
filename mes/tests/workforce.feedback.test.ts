import { describe, expect, it } from 'vitest';
import { buildActualFeedbackBatch } from '../src/integration/workforce/feedback';
import { MesState } from '../src/types';

function state(): MesState {
  return {
    plan: { id: 'MES-PLAN', version: 4, horizonStart: '2026-09-01T00:00:00.000Z', horizonEnd: '2026-10-01T00:00:00.000Z', status: 'DRAFT' },
    products: [{ id: 'P1', code: 'P-1', name: 'Изделие', unit: 'шт' }],
    employees: [],
    equipment: [{ id: 'EQ1', code: 'M-1', name: 'Станок', workCenter: 'Участок', capabilities: ['CUT'], active: true }],
    shifts: [], calendar: [], employeeSchedules: [], equipmentBlocks: [],
    orders: [{ id: 'O1', externalId: 'WF-O1', number: 'O-1', productId: 'P1', quantity: 10, completedQuantity: 0, dueAt: '2026-09-10T00:00:00.000Z', priority: 'NORMAL', status: 'IN_EXECUTION', route: [] }],
    tasks: [{ id: 'T1', orderId: 'O1', operationId: 'OP1', operationSequence: 10, status: 'COMPLETED', plannedStart: '2026-09-08T08:00:00.000Z', plannedEnd: '2026-09-08T09:00:00.000Z', actualStart: '2026-09-08T08:01:00.000Z', actualEnd: '2026-09-08T09:03:00.000Z', plannedQuantity: 10, actualQuantity: 10, assignedEmployeeIds: ['E1'], assignedEquipmentIds: ['EQ1'], version: 2 }],
    downtimes: [], maintenance: [], results: [{ id: 'R1', taskId: 'T1', recordedAt: '2026-09-08T09:02:00.000Z', goodQuantity: 9, scrapQuantity: 1, employeeIds: ['E1'], equipmentIds: ['EQ1'] }],
    events: [{ id: 'EV1', taskId: 'T1', type: 'RESULT_RECORDED', occurredAt: '2026-09-08T09:02:00.000Z', actorId: 'operator-1', payload: { resultId: 'R1' } }]
  };
}

describe('Workforce actual feedback', () => {
  it('builds a versioned batch from MES events', () => {
    const dto = buildActualFeedbackBatch(state(), 'SITE-1', '2026-09-08T10:00:00.000Z');
    expect(dto.contractVersion).toBe('1.0');
    expect(dto.sourceSiteExternalId).toBe('SITE-1');
    expect(dto.events).toHaveLength(1);
    expect(dto.events[0].eventType).toBe('RESULT_RECORDED');
    expect(dto.events[0].mesPlanVersion).toBe(4);
    expect(dto.events[0].productionOrderExternalId).toBe('WF-O1');
    expect(dto.events[0].quantityGood).toBe(9);
    expect(dto.events[0].quantityScrap).toBe(1);
    expect(dto.events[0].idempotencyKey).toBe('EV1');
  });
});
