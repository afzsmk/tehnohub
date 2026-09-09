import { describe, expect, it } from 'vitest';
import { applyRemoteSnapshot, RemoteSnapshot } from '../src/integration/remoteState';
import type { MesState } from '../src/types';

const baseState: MesState = {
  plan: { id: 'PLAN-1', version: 1, horizonStart: '2026-01-01', horizonEnd: '2026-01-30', status: 'DRAFT' },
  products: [], employees: [], equipment: [], shifts: [], calendar: [], employeeSchedules: [],
  equipmentBlocks: [], orders: [], tasks: [], downtimes: [], maintenance: [], results: [],
  qualityInspections: [], events: []
};

const snapshot: RemoteSnapshot = {
  ...baseState,
  qualityInspections: [{
    id: 'QI-1', taskId: 'TASK-1', inspectedAt: '2026-01-02T10:00:00Z', inspectorId: 'USER-Q',
    status: 'APPROVED', goodQuantity: 10, scrapQuantity: 0, comment: 'approved'
  }]
};

describe('MES remote state hydration', () => {
  it('keeps quality inspection history when applying the remote snapshot', () => {
    const state: MesState = { ...baseState, qualityInspections: undefined };

    applyRemoteSnapshot(state, snapshot);

    expect(state.qualityInspections).toEqual(snapshot.qualityInspections);
  });
});
