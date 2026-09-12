import { describe, expect, it } from 'vitest';
import { recordProductionResult, executeTaskAction } from '../src/core/execution';
import { MesState } from '../src/types';

function state(): MesState {
  const at = '2026-09-08T08:00:00.000Z';
  return {
    plan: { id: 'PLAN-1', version: 1, horizonStart: at, horizonEnd: '2026-09-10T08:00:00.000Z', status: 'RELEASED' },
    products: [], employees: [], equipment: [], shifts: [], calendar: [], employeeSchedules: [], equipmentBlocks: [],
    orders: [{ id: 'O-1', number: 'O-1', productId: 'P-1', quantity: 10, completedQuantity: 0, dueAt: '2026-09-09T08:00:00.000Z', priority: 'NORMAL', status: 'IN_EXECUTION', route: [{ id: 'OP-1', sequence: 10, code: 'OP', name: 'OP', workCenter: 'WC', setupMinutes: 0, runMinutesPerUnit: 1 }] }],
    tasks: [{ id: 'T-1', orderId: 'O-1', operationId: 'OP-1', operationSequence: 10, status: 'READY', plannedStart: at, plannedEnd: '2026-09-08T08:10:00.000Z', plannedQuantity: 10, actualQuantity: 0, assignedEmployeeIds: ['E-1'], assignedEquipmentIds: [], version: 1 }],
    downtimes: [], maintenance: [], results: [], events: []
  };
}

describe('execution identity', () => {
  it('does not allow an operator to execute an unassigned task', () => {
    const s = state();
    expect(() => executeTaskAction(s, 'T-1', 'START', { userId: 'U-1', employeeId: 'E-2', role: 'OPERATOR' })).toThrow('Сотрудник не назначен');
  });

  it('stores authenticated user and bound employee in execution events', () => {
    const s = state();
    executeTaskAction(s, 'T-1', 'START', { userId: 'U-1', employeeId: 'E-1', role: 'OPERATOR' });
    expect(s.events[0].actorId).toBe('U-1');
    expect(s.events[0].payload.employeeId).toBe('E-1');
  });

  it('forces operator results to use the bound employee', () => {
    const s = state();
    executeTaskAction(s, 'T-1', 'START', { userId: 'U-1', employeeId: 'E-1', role: 'OPERATOR' });
    const result = recordProductionResult(s, 'T-1', { goodQuantity: 2, scrapQuantity: 0, employeeIds: ['E-2'], equipmentIds: [] }, { userId: 'U-1', employeeId: 'E-1', role: 'OPERATOR' });
    expect(result.employeeIds).toEqual(['E-1']);
  });
});
