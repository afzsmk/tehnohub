import { describe, expect, it } from 'vitest';
import { buildPublishedPlanDto, nextPublicationVersion } from '../src/integration/mes/publication';
import { ensureMesPlanId } from '../src/integration/mes/publisher';
import { PRELOADED_STATE } from '../src/services/storage/defaultState';

describe('Workforce → MES publication contract', () => {
  it('builds an immutable published snapshot from the current scenario', () => {
    const scenario = PRELOADED_STATE.scenarios['План сент-окт 2026'];
    const dto = buildPublishedPlanDto(scenario, {
      planId: 'WF-2026-09',
      version: 1,
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main',
      publishedAt: '2026-09-10T08:00:00.000Z'
    });

    expect(dto.contractVersion).toBe('1.0');
    expect(dto.status).toBe('PUBLISHED');
    expect(dto.idempotencyKey).toBe('WF:WF-2026-09:1');
    expect(dto.monthlyPlan.every(item => /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month))).toBe(true);
    expect(dto.products.length).toBe(scenario.products.length);
    expect(dto.professions.length).toBe(scenario.professions.length);

    const first = dto.monthlyPlan[0];
    expect(first).toEqual({
      month: '2026-09',
      productExternalId: 'pr1',
      quantity: 2014.65
    });
  });

  it('does not mutate the source scenario', () => {
    const scenario = PRELOADED_STATE.scenarios['План сент-окт 2026'];
    const before = JSON.stringify(scenario);

    buildPublishedPlanDto(scenario, {
      planId: 'WF-2026-09',
      version: 1,
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main',
      publishedAt: '2026-09-10T08:00:00.000Z'
    });

    expect(JSON.stringify(scenario)).toBe(before);
  });

  it('increments only the selected plan history', () => {
    const history = [
      { planId: 'A', version: 1 },
      { planId: 'A', version: 3 },
      { planId: 'B', version: 8 }
    ];

    expect(nextPublicationVersion(history, 'A')).toBe(4);
    expect(nextPublicationVersion(history, 'B')).toBe(9);
    expect(nextPublicationVersion(history, 'C')).toBe(1);
  });

  it('generates distinct stable identifiers for Cyrillic scenario names', () => {
    const first = PRELOADED_STATE.scenarios['План сент-окт 2026'];
    const second = PRELOADED_STATE.scenarios['Производство 2026'];

    const firstPlanId = ensureMesPlanId(first, 'План сент-окт 2026');
    const secondPlanId = ensureMesPlanId(second, 'Производство 2026');

    expect(firstPlanId).toBe('WF-ПЛАН-СЕНТ-ОКТ-2026');
    expect(secondPlanId).toBe('WF-ПРОИЗВОДСТВО-2026');
    expect(firstPlanId).not.toBe(secondPlanId);
  });

  it('keeps an explicitly persisted plan id stable', () => {
    const scenario = structuredClone(PRELOADED_STATE.scenarios['План сент-окт 2026']);
    scenario.mesPublication = {
      planId: 'WF-CANONICAL-2026',
      version: 2,
      status: 'PUBLISHED'
    };

    expect(ensureMesPlanId(scenario, 'Новое имя')).toBe('WF-CANONICAL-2026');
  });

  it('rejects publication metadata that cannot identify the published version', () => {
    const scenario = PRELOADED_STATE.scenarios['План сент-окт 2026'];

    expect(() => buildPublishedPlanDto(scenario, {
      planId: '',
      version: 1,
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main'
    })).toThrow('planId обязателен');

    expect(() => buildPublishedPlanDto(scenario, {
      planId: 'WF-2026-09',
      version: 0,
      publishedBy: 'planner:test',
      companyExternalId: 'zsmk',
      siteExternalId: 'zsmk-main'
    })).toThrow('version должен быть положительным целым');
  });
});
