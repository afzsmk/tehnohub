import { describe, expect, it, vi } from 'vitest';
import { ScenarioData } from '../../../types';
import { MesApiClient } from '../apiClient';
import { buildWorkforcePublishedPlan } from '../mapper';
import { preparePublication } from '../publicationService';
import { validatePublishedPlan } from '../validator';

function scenario(): ScenarioData {
  return {
    professions: [
      { id: 'p1', name: 'Оператор', pool: 'universal', crew: 1 },
    ],
    products: [
      { id: 'prod1', name: 'Изделие A', unit: 'шт', scrap: 2, norms: { p1: 1.5 } },
    ],
    months: ['2026-01', '2026-02'],
    plan: { prod1: [10, 20] },
    settings: {
      fNom: 168,
      fEff: 144,
      reserveOffPercent: 14.3,
      kVn: 1,
      brigadesCount: 3,
      brigadeSize: 6,
      maxOvertimePercent: 15,
      auxOtkPercent: 0,
      auxSetupPercent: 0,
      auxFixedPosts: 0,
      workDaysPerMonth: 21,
      shiftHoursStandard: 8,
      extendedShiftHours: 12,
      fNomExtended: 252,
      fEffExtended: 216,
    },
  };
}

describe('MES integration', () => {
  it('maps monthly plan rows into stable orders and labor', () => {
    const data = scenario();
    const payload = buildWorkforcePublishedPlan(data, {
      scenarioId: 'scenario-1',
      applicationVersion: '2.0.0',
      planId: 'plan-1',
      version: 1,
      publishedAt: '2026-09-08T08:00:00.000Z',
      messageId: 'msg-1',
    });

    expect(payload.idempotencyKey).toBe('workforce:plan:plan-1:v1');
    expect(payload.orders).toHaveLength(2);
    expect(payload.orders[0].externalId).toBe('WF-prod1-2026-01');
    expect(payload.orders[0].plannedLaborHours).toBe(15);
    expect(validatePublishedPlan(payload)).toEqual([]);
  });

  it('keeps plan id stable and increments version', () => {
    const data = { ...scenario(), publication: { planId: 'plan-1', version: 3, status: 'published' as const } };
    const prepared = preparePublication(data, {
      scenarioId: 'scenario-1',
      scenarioName: 'Основной план',
      applicationVersion: '2.0.0',
      publishedBy: 'planner-1',
      now: '2026-09-08T09:00:00.000Z',
    });

    expect(prepared.publication.planId).toBe('plan-1');
    expect(prepared.publication.version).toBe(4);
    expect(prepared.payload.scenarioName).toBe('Основной план');
  });

  it('sends idempotency key to MES', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, messageId: 'msg-1' }), { status: 200 }),
    );
    const client = new MesApiClient({ baseUrl: 'https://mes.example', fetchImpl });
    const data = scenario();
    const payload = buildWorkforcePublishedPlan(data, {
      scenarioId: 'scenario-1',
      applicationVersion: '2.0.0',
      planId: 'plan-1',
      version: 1,
      messageId: 'msg-1',
    });

    await client.publishPlan(payload);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://mes.example/api/v1/integrations/workforce/plans');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('workforce:plan:plan-1:v1');
  });
});
