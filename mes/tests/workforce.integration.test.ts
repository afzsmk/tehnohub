import { describe, expect, it } from 'vitest';
import {
  InMemoryWorkforceIntegrationStore,
  WorkforceIntegrationService,
  WorkforcePublishedPlanDto,
  validatePublishedPlan,
  validateActualFeedback
} from '../src/integration/workforce';

function publishedPlan(): WorkforcePublishedPlanDto {
  return {
    contractVersion: '1.0',
    planId: 'WF-PLAN-1',
    version: 3,
    status: 'PUBLISHED',
    publishedAt: '2026-09-08T10:00:00.000Z',
    publishedBy: 'planner-1',
    companyExternalId: 'COMPANY-ZSMK',
    siteExternalId: 'SITE-1',
    products: [{ externalId: 'P-EXT-1', code: 'PANEL-01', name: 'Сотовая панель', unit: 'м²' }],
    professions: [{ externalId: 'PROF-1', code: 'OP', name: 'Оператор' }],
    monthlyPlan: [{ month: '2026-10', productExternalId: 'P-EXT-1', quantity: 120 }],
    idempotencyKey: 'WF-PLAN-1:3'
  };
}

describe('Workforce-MES integration contract', () => {
  it('validates a published plan and maps it to an imported order', () => {
    const dto = publishedPlan();
    expect(() => validatePublishedPlan(dto)).not.toThrow();
    const service = new WorkforceIntegrationService(new InMemoryWorkforceIntegrationStore());
    const result = service.importPublishedPlan(dto, 'mes-importer');
    expect(result.receipt.accepted).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].externalId).toBe('WF-PLAN-1:3:2026-10:P-EXT-1');
    expect(result.orders[0].status).toBe('IMPORTED');
  });

  it('is idempotent for a repeated published-plan delivery', () => {
    const store = new InMemoryWorkforceIntegrationStore();
    const service = new WorkforceIntegrationService(store);
    const dto = publishedPlan();
    expect(service.importPublishedPlan(dto, 'mes-importer').orders).toHaveLength(1);
    const repeated = service.importPublishedPlan(dto, 'mes-importer');
    expect(repeated.orders).toHaveLength(0);
    expect(repeated.receipt.message).toContain('Повторная доставка');
  });

  it('rejects a non-published plan', () => {
    const dto = { ...publishedPlan(), status: 'DRAFT' as const };
    expect(() => validatePublishedPlan(dto)).toThrow('только опубликованные');
  });

  it('rejects duplicate actual-event idempotency keys inside one batch', () => {
    const event = {
      contractVersion: '1.0',
      eventId: 'EV-1',
      eventType: 'RESULT_RECORDED' as const,
      occurredAt: '2026-09-08T11:00:00.000Z',
      mesPlanId: 'MES-1',
      mesPlanVersion: 2,
      quantityGood: 10,
      quantityScrap: 1,
      idempotencyKey: 'EV-1',
      actorId: 'operator-1'
    };
    expect(() => validateActualFeedback({ contractVersion: '1.0', sentAt: '2026-09-08T11:05:00.000Z', sourceSiteExternalId: 'SITE-1', events: [event, { ...event, eventId: 'EV-2' }] })).toThrow('Дублируется idempotencyKey');
  });
});
