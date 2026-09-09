import { describe, expect, it } from 'vitest';
import { executeTaskAction, recordProductionResult, startDowntime, endDowntime } from '../src/core/execution';
import { DowntimeEvent, ProductionTask } from '../src/types';

function task(status: ProductionTask['status'] = 'READY'): ProductionTask {
  return {
    id: 'T1', orderId: 'O1', operationId: 'OP1', operationSequence: 10, status,
    plannedStart: '2030-01-01T08:00:00.000Z', plannedEnd: '2030-01-01T08:30:00.000Z',
    plannedQuantity: 10, actualQuantity: 0, assignedEmployeeIds: ['E1'], assignedEquipmentIds: ['EQ1'], version: 1
  };
}

describe('MES shop-floor execution', () => {
  it('prepares and starts a task', () => {
    const state = { tasks: [task('PLANNED')], results: [], downtimes: [], events: [] };
    executeTaskAction(state, 'T1', 'PREPARE', 'E1', '2030-01-01T07:55:00.000Z');
    executeTaskAction(state, 'T1', 'PREPARE', 'E1', '2030-01-01T07:56:00.000Z');
    executeTaskAction(state, 'T1', 'START', 'E1', '2030-01-01T08:00:00.000Z');
    expect(state.tasks[0].status).toBe('RUNNING');
    expect(state.tasks[0].actualStart).toBe('2030-01-01T08:00:00.000Z');
  });

  it('records production and completes at planned quantity', () => {
    const state = { tasks: [task()], results: [], downtimes: [], events: [] };
    executeTaskAction(state, 'T1', 'START', 'E1', '2030-01-01T08:00:00.000Z');
    recordProductionResult(state, 'T1', { goodQuantity: 8, scrapQuantity: 1, employeeIds: ['E1'], equipmentIds: ['EQ1'] }, 'E1', '2030-01-01T09:00:00.000Z');
    expect(state.tasks[0].actualQuantity).toBe(8);
    expect(state.tasks[0].status).toBe('PARTIALLY_COMPLETED');
    recordProductionResult(state, 'T1', { goodQuantity: 2, scrapQuantity: 0, employeeIds: ['E1'], equipmentIds: ['EQ1'] }, 'E1', '2030-01-01T09:10:00.000Z');
    expect(state.tasks[0].status).toBe('COMPLETED');
    expect(state.results).toHaveLength(2);
  });

  it('rejects production above plan', () => {
    const state = { tasks: [task()], results: [], downtimes: [], events: [] };
    executeTaskAction(state, 'T1', 'START', 'E1', '2030-01-01T08:00:00.000Z');
    expect(() => recordProductionResult(state, 'T1', { goodQuantity: 11, scrapQuantity: 0, employeeIds: ['E1'], equipmentIds: ['EQ1'] }, 'E1')).toThrow('превышает плановое количество');
  });

  it('opens and closes equipment downtime', () => {
    const state: { tasks: ProductionTask[]; results: ReturnType<typeof recordProductionResult>[]; downtimes: DowntimeEvent[]; events: never[] } = { tasks: [], results: [], downtimes: [], events: [] };
    const downtime = startDowntime(state, { equipmentId: 'EQ1', reasonCode: 'BREAKDOWN' }, 'E1', '2030-01-01T10:00:00.000Z');
    expect(() => startDowntime(state, { equipmentId: 'EQ1', reasonCode: 'OTHER' }, 'E1')).toThrow('уже зарегистрирован');
    endDowntime(state, downtime.id, 'E1', '2030-01-01T10:25:00.000Z');
    expect(state.downtimes[0].endedAt).toBe('2030-01-01T10:25:00.000Z');
  });
});
