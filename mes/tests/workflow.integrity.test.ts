import { describe, expect, it } from 'vitest';
import type { MesState, ProductionOrder, ProductionTask } from '../src/types';

function makeState(task: ProductionTask, order: ProductionOrder): MesState {
  return {
    plan: { id: 'P1', version: 1, horizonStart: '2026-09-01', horizonEnd: '2026-10-01', status: 'RELEASED' },
    products: [{ id: order.productId, code: 'PRD-1', name: 'Product', unit: 'шт' }],
    employees: [], equipment: [], shifts: [], calendar: [], employeeSchedules: [], equipmentBlocks: [],
    orders: [order], tasks: [task], downtimes: [], maintenance: [], results: [], qualityInspections: [], events: []
  };
}

function baseOrder(): ProductionOrder {
  return { id: 'O1', number: 'O-1', productId: 'P1', quantity: 100, completedQuantity: 0, dueAt: '2026-09-10T12:00:00Z', priority: 'NORMAL', status: 'IN_EXECUTION', route: [] };
}

function baseTask(overrides: Partial<ProductionTask> = {}): ProductionTask {
  return {
    id: 'T1', orderId: 'O1', operationId: 'OP2', operationSequence: 20, status: 'PARTIALLY_COMPLETED',
    plannedStart: '2026-09-08T08:00:00Z', plannedEnd: '2026-09-08T16:00:00Z',
    plannedQuantity: 100, actualQuantity: 80, assignedEmployeeIds: [], assignedEquipmentIds: [], version: 3,
    qualityRequired: true, qualityStatus: 'PENDING', ...overrides
  };
}

describe('MES production workflow invariants', () => {
  it('does not expose a task as completed while required quality is pending', () => {
    const task = baseTask({ status: 'PARTIALLY_COMPLETED', actualQuantity: 100, qualityStatus: 'PENDING' });
    const state = makeState(task, baseOrder());
    expect(state.tasks[0].status).toBe('PARTIALLY_COMPLETED');
    expect(state.tasks[0].qualityStatus).toBe('PENDING');
  });

  it('allows the authoritative state to represent completed task only after quality approval', () => {
    const task = baseTask({ status: 'COMPLETED', actualQuantity: 100, qualityStatus: 'APPROVED' });
    const state = makeState(task, { ...baseOrder(), completedQuantity: 100, status: 'COMPLETED' });
    expect(state.tasks[0].status).toBe('COMPLETED');
    expect(state.tasks[0].qualityStatus).toBe('APPROVED');
    expect(state.orders[0].completedQuantity).toBe(100);
    expect(state.orders[0].status).toBe('COMPLETED');
  });

  it('keeps partial execution reflected at order level before latest operation completion', () => {
    const task = baseTask({ status: 'PARTIALLY_COMPLETED', actualQuantity: 40, qualityStatus: 'PENDING' });
    const state = makeState(task, { ...baseOrder(), completedQuantity: 40, status: 'PARTIALLY_COMPLETED' });
    expect(state.orders[0].completedQuantity).toBeLessThan(state.orders[0].quantity);
    expect(state.orders[0].status).toBe('PARTIALLY_COMPLETED');
  });
});
