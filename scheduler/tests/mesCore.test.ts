import { describe, expect, it } from 'vitest';
import { generateStationCalendar } from '../src/core/calendar';
import { buildSchedule } from '../src/core/schedulerEngine';
import { assertTaskTransition, canTransitionTask } from '../src/mes/taskStateMachine';
import { isEquipmentBlocked } from '../src/mes/constraints';
import { MesMaintenanceOrder } from '../src/mes/types';
import { ProductRouting, ProductionOrder, StationScheduleConfig } from '../src/types';

describe('MES execution foundation', () => {
  it('allows only valid production-task state transitions', () => {
    expect(canTransitionTask('DRAFT', 'PLANNED')).toBe(true);
    expect(canTransitionTask('PLANNED', 'RUNNING')).toBe(false);
    expect(canTransitionTask('COMPLETED', 'RUNNING')).toBe(false);
    expect(() => assertTaskTransition('COMPLETED', 'RUNNING')).toThrow();
  });

  it('treats maintenance as a hard equipment block', () => {
    const maintenance: MesMaintenanceOrder[] = [{
      id: 'm1',
      equipmentId: 'eq1',
      type: 'PPR',
      status: 'PLANNED',
      plannedStart: '2026-09-14T08:00:00.000Z',
      plannedEnd: '2026-09-14T12:00:00.000Z',
    }];

    expect(isEquipmentBlocked('eq1', '2026-09-14T09:00:00.000Z', '2026-09-14T10:00:00.000Z', maintenance)).toBe(true);
    expect(isEquipmentBlocked('eq1', '2026-09-14T13:00:00.000Z', '2026-09-14T14:00:00.000Z', maintenance)).toBe(false);
  });

  it('does not allocate capacity during a maintenance override', () => {
    const stations: StationScheduleConfig[] = [{
      professionId: 'laser', professionName: 'Лазер', pattern: '5_2_single',
      defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 1, crewPerMachine: 1, totalMachines: 1,
    }];
    const slots = generateStationCalendar({
      startDate: '2026-09-14',
      daysCount: 1,
      stations,
      overrides: [{ professionId: 'laser', date: '2026-09-14', shiftNumber: 1, isActive: true, isMaintenance: true, shiftHours: 8, availableWorkers: 1 }],
    });
    expect(slots[0].isWorking).toBe(false);
    expect(slots[0].totalCapacityHours).toBe(0);
  });

  it('honours a non-zero inter-operation buffer before the next routing step', () => {
    const stations: StationScheduleConfig[] = [
      { professionId: 'laser', professionName: 'Лазер', pattern: 'continuous_24h', defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 1, crewPerMachine: 1, totalMachines: 1 },
      { professionId: 'glue', professionName: 'Склейка', pattern: 'continuous_24h', defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 1, crewPerMachine: 1, totalMachines: 1 },
    ];
    const routings: Record<string, ProductRouting> = {
      panel: {
        id: 'rt1', productId: 'panel', productName: 'Панель', steps: [
          { stepNumber: 10, professionId: 'laser', professionName: 'Лазер', normPerUnit: 1, setupTimeHours: 0, bufferHoursAfter: 8 },
          { stepNumber: 20, professionId: 'glue', professionName: 'Склейка', normPerUnit: 1, setupTimeHours: 0, bufferHoursAfter: 0 },
        ],
      },
    };
    const orders: ProductionOrder[] = [{
      id: 'o1', orderNumber: 'O-1', customer: 'C', productId: 'panel', productName: 'Панель', quantity: 8,
      unit: 'шт', dueDate: '2026-09-16', priority: 'normal', status: 'new',
    }];
    const slots = generateStationCalendar({ startDate: '2026-09-14', daysCount: 3, stations });
    const result = buildSchedule({ orders, routings, slots });
    const first = result.tasks.find(t => t.stepNumber === 10)!;
    const second = result.tasks.find(t => t.stepNumber === 20)!;

    expect(new Date(second.startDate).getTime()).toBeGreaterThanOrEqual(new Date(first.endDate).getTime());
    expect(second.startDate).not.toBe(first.endDate);
  });
});
