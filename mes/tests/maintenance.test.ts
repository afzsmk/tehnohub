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
    expect(state.equipmentBlocks).toEqual([expect.objectContaining({ id: `MB-${order.id}`, equipmentId: 'EQ-1', reason: 'MAINTENANCE' })]);
  });

  it('stores MES plan context on maintenance events', () => {
    const state = buildState();
    createMaintenanceOrder(state, baseInput, 'A-1');
    expect(state.events[0].payload).toEqual(expect.objectContaining({ mesPlanId: 'P', mesPlanVersion: 1, equipmentId: 'EQ-1' }));
  });

  it('prevents overlapping active maintenance', () => {
    const state = buildState();
    createMaintenanceOrder(state, baseInput, 'A-1');
    expect(() => createMaintenanceOrder(state, { ...baseInput, plannedStart: '2026-01-10T09:00:00.000Z', plannedEnd: '2026-01-10T11:00:00.000Z' }, 'A-1')).toThrow('пересекающееся');
  });

  it('supports start and complete, removing block on completion', () => {
    const state = buildState();
    const order = createMaintenanceOrder(state, baseInput, 'A-1');
    transitionMaintenance(state, order.id, 'START', 'A-1');
    expect(order.status).toBe('IN_PROGRESS');
    transitionMaintenance(state, order.id, 'COMPLETE', 'A-1');
    expect(order.status).toBe('DONE');
    expect(state.equipmentBlocks).toHaveLength(0);
  });

  it('cancels a planned maintenance and removes block', () => {
    const state = buildState();
    const order = createMaintenanceOrder(state, baseInput, 'A-1');
    transitionMaintenance(state, order.id, 'CANCEL', 'A-1');
    expect(order.status).toBe('CANCELLED');
    expect(state.equipmentBlocks).toHaveLength(0);
  });
});
