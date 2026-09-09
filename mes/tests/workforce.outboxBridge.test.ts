import { describe, expect, it } from 'vitest';
import { enqueueNewActualFeedbackEvents } from '../src/integration/workforce/outboxBridge';
import { InMemoryWorkforceOutboxStore } from '../src/integration/workforce/outbox';
import { MesState } from '../src/types';

function stateWithEvents(): MesState {
  return {
    plan: { id: 'MES-1', version: 2, horizonStart: '2026-09-08T00:00:00.000Z', horizonEnd: '2026-10-08T00:00:00.000Z', status: 'DRAFT' },
    products: [{ id: 'P-1', code: 'P1', name: 'Панель', unit: 'шт' }],
    employees: [{ id: 'E-1', personnelNo: '1', name: 'Оператор', profession: 'Оператор', qualificationLevel: 3, active: true }],
    equipment: [{ id: 'EQ-1', code: 'EQ1', name: 'Станок', workCenter: 'Цех', capabilities: ['CUT'], active: true }],
    shifts: [],
    calendar: [],
    employeeSchedules: [],
    equipmentBlocks: [],
    orders: [{ id: 'O-1', number: 'O-1', productId: 'P-1', quantity: 10, completedQuantity: 10, dueAt: '2026-09-10T00:00:00.000Z', priority: 'NORMAL', status: 'COMPLETED', externalId: 'WF-O-1', route: [] }],
    tasks: [],
    downtimes: [],
    maintenance: [],
    results: [{ id: 'RES-1', taskId: 'TASK-1', recordedAt: '2026-09-08T12:00:00.000Z', goodQuantity: 10, scrapQuantity: 1, employeeIds: ['E-1'], equipmentIds: ['EQ-1'] }],
    events: [
      { id: 'EV-1', taskId: 'TASK-1', type: 'RESULT_RECORDED', occurredAt: '2026-09-08T12:00:00.000Z', actorId: 'E-1', payload: { resultId: 'RES-1' } },
      { id: 'EV-2', type: 'DOWNTIME_STARTED', occurredAt: '2026-09-08T12:05:00.000Z', actorId: 'E-1', payload: { equipmentId: 'EQ-1' } },
      { id: 'EV-3', type: 'TASK_STARTED', taskId: 'TASK-1', occurredAt: '2026-09-08T12:10:00.000Z', actorId: 'E-1', payload: {} }
    ]
  };
}

describe('Workforce outbox bridge', () => {
  it('enqueues only events created after the captured event-id boundary', () => {
    const state = stateWithEvents();
    const store = new InMemoryWorkforceOutboxStore();
    const previous = new Set(['EV-1']);

    const count = enqueueNewActualFeedbackEvents(state, previous, store, 'SITE-1', '2026-09-08T12:20:00.000Z');

    expect(count).toBe(1);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].event.eventId).toBe('EV-2');
  });

  it('is naturally idempotent when the same MES event is bridged twice', () => {
    const state = stateWithEvents();
    const store = new InMemoryWorkforceOutboxStore();
    const previous = new Set<string>();

    enqueueNewActualFeedbackEvents(state, previous, store, 'SITE-1');
    enqueueNewActualFeedbackEvents(state, previous, store, 'SITE-1');

    expect(store.list()).toHaveLength(2);
    expect(store.list().map(item => item.idempotencyKey)).toEqual(['EV-1', 'EV-2']);
  });
});
