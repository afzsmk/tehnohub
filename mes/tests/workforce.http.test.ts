import { describe, expect, it, vi } from 'vitest';
import { WorkforceMesHttpClientImpl } from '../src/integration/workforce/http';
import { WorkforcePublishedPlanDto } from '../src/integration/workforce/types';

function publishedPlan(): WorkforcePublishedPlanDto {
  return {
    contractVersion: '1.0',
    planId: 'WF-PLAN-1',
    version: 5,
    status: 'PUBLISHED',
    publishedAt: '2026-09-08T12:00:00.000Z',
    publishedBy: 'planner-1',
    companyExternalId: 'COMPANY-ZSMK',
    siteExternalId: 'SITE-1',
    products: [{ externalId: 'P-EXT-1', code: 'PANEL-01', name: 'Панель', unit: 'м²' }],
    professions: [{ externalId: 'PROF-1', code: 'OP', name: 'Оператор' }],
    monthlyPlan: [{ month: '2026-10', productExternalId: 'P-EXT-1', quantity: 100 }],
    idempotencyKey: 'WF-PLAN-1:5'
  };
}

function response(body: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Workforce-MES HTTP client', () => {
  it('posts a validated published plan with bearer token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      contractVersion: '1.0', idempotencyKey: 'WF-PLAN-1:5', sourcePlanId: 'WF-PLAN-1', sourcePlanVersion: 5,
      importedAt: '2026-09-08T12:01:00.000Z', importedBy: 'mes', accepted: true
    }));
    const client = new WorkforceMesHttpClientImpl({ baseUrl: 'https://mes.example/', token: 'secret', fetchImpl });

    const receipt = await client.importPublishedPlan(publishedPlan());

    expect(receipt.accepted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://mes.example/api/mes/v1/workforce/plans');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body)).idempotencyKey).toBe('WF-PLAN-1:5');
  });

  it('retries transient HTTP failures and eventually succeeds', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ message: 'temporary failure' }, 503))
      .mockResolvedValueOnce(response({ message: 'rate limited' }, 429))
      .mockResolvedValueOnce(response(undefined, 204));
    const client = new WorkforceMesHttpClientImpl({ baseUrl: 'http://mes.local', fetchImpl, retries: 2, retryDelayMs: 0 });

    await expect(client.sendActualFeedback({
      contractVersion: '1.0', sentAt: '2026-09-08T12:00:00.000Z', sourceSiteExternalId: 'SITE-1', events: []
    })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry a client error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ message: 'bad request' }, 400));
    const client = new WorkforceMesHttpClientImpl({ baseUrl: 'http://mes.local', fetchImpl, retries: 3, retryDelayMs: 0 });

    await expect(client.importPublishedPlan(publishedPlan())).rejects.toThrow(/^MES API 400:/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
