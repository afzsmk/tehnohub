import { describe, expect, it } from 'vitest';
import { createWorkforceMesApi } from '../src/integration/workforce/api';
import { InMemoryWorkforceIntegrationStore, WorkforceIntegrationService } from '../src/integration/workforce/service';
import { WorkforcePublishedPlanDto } from '../src/integration/workforce/types';

function publishedPlan(status: WorkforcePublishedPlanDto['status'] = 'PUBLISHED'): WorkforcePublishedPlanDto {
  return {
    contractVersion: '1.0',
    planId: 'WF-PLAN-API',
    version: 2,
    status,
    publishedAt: '2026-09-08T12:00:00.000Z',
    publishedBy: 'planner-1',
    companyExternalId: 'COMPANY-ZSMK',
    siteExternalId: 'SITE-1',
    products: [{ externalId: 'P-EXT-1', code: 'PANEL-01', name: 'Панель', unit: 'м²' }],
    professions: [{ externalId: 'PROF-1', code: 'OP', name: 'Оператор' }],
    monthlyPlan: [{ month: '2026-10', productExternalId: 'P-EXT-1', quantity: 100 }],
    idempotencyKey: 'WF-PLAN-API:2'
  };
}

function api(options?: { expectedBearerToken?: string }) {
  return createWorkforceMesApi({
    service: new WorkforceIntegrationService(new InMemoryWorkforceIntegrationStore()),
    ...options
  });
}

describe('Workforce MES HTTP API', () => {
  it('accepts a published Workforce plan and returns correlation id', async () => {
    const response = await api()(new Request('https://mes.local/api/mes/v1/workforce/plans', {
      method: 'POST',
      headers: { 'x-actor-id': 'api-user', 'idempotency-key': 'WF-PLAN-API:2', 'x-correlation-id': 'corr-123', 'Content-Type': 'application/json' },
      body: JSON.stringify(publishedPlan())
    }));

    expect(response.status).toBe(202);
    expect(response.headers.get('x-correlation-id')).toBe('corr-123');
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.sourcePlanId).toBe('WF-PLAN-API');
    expect(body.importedBy).toBe('api-user');
  });

  it('rejects an idempotency header mismatch', async () => {
    const response = await api()(new Request('https://mes.local/api/mes/v1/workforce/plans', {
      method: 'POST',
      headers: { 'idempotency-key': 'wrong-key', 'Content-Type': 'application/json' },
      body: JSON.stringify(publishedPlan())
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('Idempotency-Key');
  });

  it('enforces optional bearer authentication', async () => {
    const handler = api({ expectedBearerToken: 'secret' });
    const unauthorized = await handler(new Request('https://mes.local/api/mes/v1/workforce/plans', { method: 'POST', body: JSON.stringify(publishedPlan()) }));
    expect(unauthorized.status).toBe(401);

    const authorized = await handler(new Request('https://mes.local/api/mes/v1/workforce/plans', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: JSON.stringify(publishedPlan())
    }));
    expect(authorized.status).toBe(202);
  });

  it('rejects a non-published plan with a client error', async () => {
    const response = await api()(new Request('https://mes.local/api/mes/v1/workforce/plans', {
      method: 'POST',
      body: JSON.stringify(publishedPlan('DRAFT'))
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('только опубликованные');
  });

  it('returns 404 for an unknown endpoint and 405 for a wrong method', async () => {
    expect((await api()(new Request('https://mes.local/api/mes/v1/workforce/unknown', { method: 'POST' }))).status).toBe(404);
    expect((await api()(new Request('https://mes.local/api/mes/v1/workforce/plans', { method: 'GET' }))).status).toBe(405);
  });
});
