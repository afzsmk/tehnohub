import { describe, expect, it } from 'vitest';
import { buildDefaultCalendar } from '../src/core/operationalCalendar';
import { canTransition, transitionTask } from '../src/core/taskLifecycle';
import { buildDeterministicSchedule } from '../src/core/scheduler';
import { Employee, Equipment, ProductionOrder, ShiftDefinition } from '../src/types';

const employees: Employee[] = [
  { id: 'E1', personnelNo: '1', name: 'Оператор 1', profession: 'Оператор', qualificationLevel: 3, active: true }
];
const equipment: Equipment[] = [
  { id: 'EQ1', code: 'M1', name: 'Станок 1', workCenter: 'Резка', capabilities: ['CUT'], active: true }
];
const shifts: ShiftDefinition[] = [
  { id: 'DAY', name: 'День', startMinute: 8 * 60, durationMinutes: 12 * 60 },
  { id: 'NIGHT', name: 'Ночь', startMinute: 20 * 60, durationMinutes: 12 * 60 }
];

function order(quantity = 10, route = [{ id: 'OP1', sequence: 10, code: 'CUT', name: 'Резка', workCenter: 'Резка', setupMinutes: 10, runMinutesPerUnit: 2 }]): ProductionOrder {
  return {
    id: 'O1', number: 'ZK-1', productId: 'P1', quantity, completedQuantity: 0,
    dueAt: '2030-01-05T00:00:00.000Z', priority: 'NORMAL', status: 'PLANNED', route
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
  it('creates a planned task inside the shift horizon', () => {
    const calendar = buildDefaultCalendar('2030-01-01T00:00:00.000Z', '2030-01-03T00:00:00.000Z', ['DAY']);
    const result = buildDeterministicSchedule({
      orders: [order()], employees, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z', horizonEnd: '2030-01-03T00:00:00.000Z',
      shifts: [shifts[0]], calendar
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].status).toBe('PLANNED');
    expect(result.tasks[0].plannedStart).toContain('T08:');
  });

  it('uses labor norm in human-hours and converts it to elapsed time', () => {
    const calendar = buildDefaultCalendar('2030-01-01T00:00:00.000Z', '2030-01-03T00:00:00.000Z', ['DAY']);
    const route = [{ id: 'OP1', sequence: 10, code: 'CUT', name: 'Резка', workCenter: 'Резка', setupMinutes: 0, runMinutesPerUnit: 0, laborNormHoursPerUnit: 1, setupNormHours: 0, workersRequired: 2 }];
    const team = [employees[0], { ...employees[0], id: 'E2', personnelNo: '2', name: 'Оператор 2' }];
    const result = buildDeterministicSchedule({
      orders: [order(10, route)], employees: team, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z', horizonEnd: '2030-01-03T00:00:00.000Z',
      shifts: [shifts[0]], calendar
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].assignedEmployeeIds).toEqual(['E1', 'E2']);
    const start = new Date(result.tasks[0].plannedStart).getTime();
    const end = new Date(result.tasks[0].plannedEnd).getTime();
    expect(end - start).toBe(5 * 60 * 60 * 1000);
  });

  it('reports insufficient worker capacity for a multi-worker operation', () => {
    const route = [{ id: 'OP1', sequence: 10, code: 'CUT', name: 'Резка', workCenter: 'Резка', setupMinutes: 0, runMinutesPerUnit: 0, laborNormHoursPerUnit: 1, setupNormHours: 0, workersRequired: 2 }];
    const result = buildDeterministicSchedule({
      orders: [order(10, route)], employees, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z', horizonEnd: '2030-01-03T00:00:00.000Z'
    });
    expect(result.tasks).toHaveLength(0);
    expect(result.conflicts[0].code).toBe('QUALIFICATION');
    expect(result.conflicts[0].message).toContain('Нужно 2');
  });

  it('reports a qualification conflict before planning', () => {
    const unqualified = [{ ...employees[0], qualificationLevel: 1 }];
    const constrained = { ...order(), route: [{ ...order().route[0], requiredQualification: 3 }] };
    const result = buildDeterministicSchedule({
      orders: [constrained], employees: unqualified, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z', horizonEnd: '2030-01-03T00:00:00.000Z'
    });
    expect(result.tasks).toHaveLength(0);
    expect(result.conflicts[0].code).toBe('QUALIFICATION');
  });

  it('does not schedule during an equipment block', () => {
    const calendar = buildDefaultCalendar('2030-01-01T00:00:00.000Z', '2030-01-03T00:00:00.000Z', ['DAY']);
    const result = buildDeterministicSchedule({
      orders: [order(300)], employees, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z', horizonEnd: '2030-01-03T00:00:00.000Z',
      shifts: [shifts[0]], calendar,
      equipmentBlocks: [{ id: 'B1', equipmentId: 'EQ1', start: '2030-01-01T08:00:00.000Z', end: '2030-01-01T16:00:00.000Z', reason: 'MAINTENANCE' }]
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.tasks[0].plannedStart).toBe('2030-01-02T08:00:00.000Z');
  });

  it('respects an employee shift assignment', () => {
    const calendar = buildDefaultCalendar('2030-01-01T00:00:00.000Z', '2030-01-02T00:00:00.000Z', ['DAY', 'NIGHT']);
    const result = buildDeterministicSchedule({
      orders: [order()], employees, equipment,
      horizonStart: '2030-01-01T00:00:00.000Z', horizonEnd: '2030-01-02T00:00:00.000Z',
      shifts, calendar,
      employeeSchedules: [{ employeeId: 'E1', date: '2030-01-01', shiftIds: ['NIGHT'], status: 'WORK' }]
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.tasks[0].plannedStart).toBe('2030-01-01T20:00:00.000Z');
  });
});
