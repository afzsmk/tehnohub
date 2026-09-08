import { describe, expect, it } from 'vitest';
import { canTransition, transitionTask } from '../src/core/taskLifecycle';
import { buildDeterministicSchedule } from '../src/core/scheduler';
import { Employee, Equipment, ProductionOrder } from '../src/types';

const employees: Employee[] = [
  { id: 'E1', personnelNo: '1', name: 'Оператор 1', profession: 'Оператор', qualificationLevel: 3, active: true }
];
const equipment: Equipment[] = [
  { id: 'EQ1', code: 'M1', name: 'Станок 1', workCenter: 'Резка', capabilities: ['CUT'], active: true }
];

function order(quantity = 10): ProductionOrder {
  return {
    id: 'O1', number: 'ZK-1', productId: 'P1', quantity, completedQuantity: 0,
    dueAt: '2030-01-05T00:00:00.000Z', priority: 'NORMAL', status: 'PLANNED',
    route: [{ id: 'OP1', sequence: 10, code: 'CUT', name: 'Резка', workCenter: 'Резка', setupMinutes: 10, runMinutesPerUnit: 2 }]
  };
}

describe('MES task lifecycle', () => {
  it('allows only explicit state transitions', () => {
    expect(canTransition('PLANNED', 'ASSIGNED')).toBe(true);
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(() => transitionTask('COMPLETED', 'RUNNING')).toThrow();
  });
});

describe('MES deterministic scheduler', () => {
  it('creates a planned task inside the horizon', () => {
    const result = buildDeterministicSchedule({
      orders: [order()], employees, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z',
      horizonEnd: '2030-01-03T00:00:00.000Z'
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].status).toBe('PLANNED');
  });

  it('reports a qualification conflict before planning', () => {
    const unqualified = [{ ...employees[0], qualificationLevel: 1 }];
    const constrained = { ...order(), route: [{ ...order().route[0], requiredQualification: 3 }] };
    const result = buildDeterministicSchedule({
      orders: [constrained], employees: unqualified, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z',
      horizonEnd: '2030-01-03T00:00:00.000Z'
    });
    expect(result.tasks).toHaveLength(0);
    expect(result.conflicts[0].code).toBe('QUALIFICATION');
  });
});
