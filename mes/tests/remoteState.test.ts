import { describe, expect, it } from 'vitest';
import { applyRemoteSnapshot, loadMesStateFromSupabase, RemoteSnapshot } from '../src/integration/remoteState';
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

function fakeClient(rowsByTable: Record<string, unknown[]>) {
  return {
    from: (table: string) => ({
      select: async () => ({ data: rowsByTable[table] ?? [], error: null })
    })
  } as never;
}

describe('MES remote state hydration', () => {
  it('keeps quality inspection history when applying the remote snapshot', () => {
    const state: MesState = { ...baseState, qualityInspections: undefined };

    applyRemoteSnapshot(state, snapshot);

    expect(state.qualityInspections).toEqual(snapshot.qualityInspections);
  });

  it('loads quality inspection history from the remote state source', async () => {
    const qualityRows = [{
      id: 'QI-1', task_id: 'TASK-1', inspected_at: '2026-01-02T10:00:00Z', inspector_id: 'USER-Q',
      status: 'APPROVED', good_quantity: '10', scrap_quantity: '0', defect_code: null, comment: 'approved'
    }];

    const remote = await loadMesStateFromSupabase(fakeClient({ quality_inspections: qualityRows }), baseState);

    expect(remote.qualityInspections).toEqual([{
      id: 'QI-1', taskId: 'TASK-1', inspectedAt: '2026-01-02T10:00:00Z', inspectorId: 'USER-Q',
      status: 'APPROVED', goodQuantity: 10, scrapQuantity: 0, defectCode: undefined, comment: 'approved'
    }]);
  });
});
