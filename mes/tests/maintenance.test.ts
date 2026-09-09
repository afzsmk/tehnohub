import { describe, expect, it } from 'vitest';
import { createMaintenanceOrder, transitionMaintenance } from '../src/core/maintenance';
import { MesState } from '../src/types';

function buildState(): MesState {
  return {
    plan: { id: 'P', version: 1, horizonStart: '2026-01-01T00:00:00.000Z', horizonEnd: '2026-02-01T00:00:00.000Z', status: 'DRAFT' },
    products: [],
    employees: [],
    equipment: [{ id: 'EQ-1', code: 'EQ-1', name: 'Станок', workCenter: 'Участок', capabilities: ['CUT'], active: true }],
    shifts: [],
    calendar: [],
    employeeSchedules: [],
    equipmentBlocks: [],
    orders: [],
    tasks: [],
    downtimes: [],
    maintenance: [],
    results: [],
    events: []
  };
}

const baseInput = {
  equipmentId: 'EQ-1',
  type: 'PM' as const,
  plannedStart: '2026-01-10T08:00:00.000Z',
  plannedEnd: '2026-01-10T10:00:00.000Z',
  comment: 'Плановое ТО'
};

describe('maintenance lifecycle', () => {
  it('creates a maintenance order and equipment block', () => {
    const state = buildState();
    const order = createMaintenanceOrder(state, baseInput, 'A-1');
    expect(order.status).toBe('PLANNED');
    expect(state.maintenance).toHaveLength(1);
    expect(state.events).toHaveLength(0);
    expect(state.equipmentBlocks).toEqual([expect.objectContaining({ id: `MB-${order.id}`, equipmentId: 'EQ-1', reason: 'MAINTENANCE' })]);
  });

  it('prevents overlapping active maintenance', () => {
    const state = buildState();
    createMaintenanceOrder(state, baseInput, 'A-1');
    expect(() => createMaintenanceOrder(state, { ...baseInput, plannedStart: '2026-01-10T09:00:00.000Z', plannedEnd: '2026-01-10T11:00:00.000Z' }, 'A-1')).toThrow('пересекающееся');
  });

  it('prevents maintenance from covering an equipment assignment', () => {
    const state = buildState();
    state.tasks = [{
      id: 'T-1', orderId: 'O-1', operationId: 'OP-1', operationSequence: 10, status: 'PLANNED',
      plannedStart: '2026-01-10T09:00:00.000Z', plannedEnd: '2026-01-10T11:00:00.000Z',
      plannedQuantity: 10, actualQuantity: 0, assignedEmployeeIds: [], assignedEquipmentIds: ['EQ-1'], version: 1
    }];
    expect(() => createMaintenanceOrder(state, baseInput, 'A-1')).toThrow('активного производственного задания');
  });

  it('supports start and complete while preserving the historical block interval', () => {
    const state = buildState();
    const order = createMaintenanceOrder(state, baseInput, 'A-1');
    transitionMaintenance(state, order.id, 'START', 'A-1');
    expect(order.status).toBe('IN_PROGRESS');
    transitionMaintenance(state, order.id, 'COMPLETE', 'A-1');
    expect(order.status).toBe('DONE');
    expect(state.equipmentBlocks).toHaveLength(1);
  });

  it('cancels a planned maintenance and removes block', () => {
    const state = buildState();
    const order = createMaintenanceOrder(state, baseInput, 'A-1');
    transitionMaintenance(state, order.id, 'CANCEL', 'A-1');
    expect(order.status).toBe('CANCELLED');
    expect(state.equipmentBlocks).toHaveLength(0);
  });
});
