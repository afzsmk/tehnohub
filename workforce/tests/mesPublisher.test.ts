import { describe, expect, it } from 'vitest';
import { PRELOADED_STATE } from '../src/services/storage/defaultState';
import {
  publishPlanForMes,
  publishPlanForMesInState,
  ensureMesPlanId,
  MesImportReceipt,
  MesPlanPublisher
} from '../src/integration/mes';

describe('Workforce → MES publication service', () => {
  const source = PRELOADED_STATE.scenarios['План сент-окт 2026'];

  function publisher(receiptOverrides: Partial<MesImportReceipt> = {}): MesPlanPublisher {
    return {
      async publish(plan) {
        return {
          contractVersion: plan.contractVersion,
          idempotencyKey: plan.idempotencyKey,
          sourcePlanId: plan.planId,
          sourcePlanVersion: plan.version,
          importedAt: '2026-09-10T09:00:00.000Z',
          importedBy: 'mes:test',
          accepted: true,
          ...receiptOverrides
        };
      }
    };
  }

  it('publishes version 1 and changes publication state only after MES accepts it', async () => {
    const result = await publishPlanForMes(source, publisher(), {
      planId: 'WF-2026-09',
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main',
      publishedAt: '2026-09-10T08:00:00.000Z'
    });

    expect(result.dto.version).toBe(1);
    expect(result.receipt.accepted).toBe(true);
    expect(result.nextScenario.mesPublication).toEqual({
      planId: 'WF-2026-09',
      version: 1,
      status: 'PUBLISHED',
      publishedAt: '2026-09-10T08:00:00.000Z',
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main'
    });
    expect(source.mesPublication).toBeUndefined();
  });

  it('increments the existing plan version', async () => {
    const scenario = structuredClone(source);
    scenario.mesPublication = {
      planId: 'WF-2026-09',
      version: 4,
      status: 'PUBLISHED'
    };

    const result = await publishPlanForMes(scenario, publisher(), {
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main',
      publishedAt: '2026-09-10T08:10:00.000Z'
    });

    expect(result.dto.planId).toBe('WF-2026-09');
    expect(result.dto.version).toBe(5);
  });

  it('does not mark a scenario published when MES rejects the plan', async () => {
    const scenario = structuredClone(source);
    await expect(publishPlanForMes(scenario, {
      async publish(plan) {
        return {
          contractVersion: plan.contractVersion,
          idempotencyKey: plan.idempotencyKey,
          sourcePlanId: plan.planId,
          sourcePlanVersion: plan.version,
          importedAt: '2026-09-10T09:00:00.000Z',
          importedBy: 'mes:test',
          accepted: false,
          message: 'Конфликт версии'
        };
      }
    }, {
      planId: 'WF-2026-09',
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main'
    })).rejects.toThrow('Конфликт версии');

    expect(scenario.mesPublication).toBeUndefined();
  });

  it('creates a deterministic plan id for a Cyrillic scenario name', () => {
    expect(ensureMesPlanId(source, 'План сент-окт 2026')).toBe('WF-ПЛАН-СЕНТ-ОКТ-2026');
  });

  it('creates distinct stable identifiers for Cyrillic scenario names', () => {
    expect(ensureMesPlanId(undefined, 'План сент-окт 2026')).toBe('WF-ПЛАН-СЕНТ-ОКТ-2026');
    expect(ensureMesPlanId(undefined, 'План ноябрь 2026')).toBe('WF-ПЛАН-НОЯБРЬ-2026');
    expect(ensureMesPlanId(undefined, 'План сент-окт 2026')).not.toBe(
      ensureMesPlanId(undefined, 'План ноябрь 2026')
    );
  });

  it('updates only the selected scenario in application state', async () => {
    const state = structuredClone(PRELOADED_STATE);
    const result = await publishPlanForMesInState(state, publisher(), {
      scenarioName: 'План сент-окт 2026',
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main',
      publishedAt: '2026-09-10T08:20:00.000Z'
    });

    expect(result.state.scenarios['План сент-окт 2026'].mesPublication?.status).toBe('PUBLISHED');
    expect(result.state.scenarios['План 21.08.2026 без Ливадии'].mesPublication).toBeUndefined();
    expect(state.scenarios['План сент-окт 2026'].mesPublication).toBeUndefined();
  });
});
