import { describe, expect, it } from 'vitest';
import { PersistentWorkforceIntegrationStore } from '../src/integration/workforce/persistence';
import { WorkforceIntegrationService } from '../src/integration/workforce/service';
import { WorkforcePublishedPlanDto } from '../src/integration/workforce/types';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

function plan(): WorkforcePublishedPlanDto {
  return {
    contractVersion: '1.0',
    planId: 'WF-PERSIST-1',
    version: 2,
    status: 'PUBLISHED',
    publishedAt: '2026-09-08T13:00:00.000Z',
    publishedBy: 'planner',
    companyExternalId: 'COMPANY-ZSMK',
    siteExternalId: 'SITE-1',
    products: [{ externalId: 'P-1', code: 'P-1', name: 'Панель', unit: 'шт' }],
    professions: [],
    monthlyPlan: [{ month: '2026-10', productExternalId: 'P-1', quantity: 10 }],
    idempotencyKey: 'WF-PERSIST-1:2'
  };
}

describe('persistent Workforce integration store', () => {
  it('keeps idempotency and history after store recreation', () => {
    const storage = new MemoryStorage();
    const firstStore = new PersistentWorkforceIntegrationStore(storage, 'test-key');
    const firstService = new WorkforceIntegrationService(firstStore);
    const dto = plan();

    expect(firstService.importPublishedPlan(dto, 'mes').orders).toHaveLength(1);
    expect(firstStore.getImportedPlans()).toHaveLength(1);
    expect(firstStore.getLog()).toHaveLength(1);

    const restoredStore = new PersistentWorkforceIntegrationStore(storage, 'test-key');
    const restoredService = new WorkforceIntegrationService(restoredStore);
    const repeated = restoredService.importPublishedPlan(dto, 'mes');

    expect(repeated.orders).toHaveLength(0);
    expect(restoredStore.getImportedPlans()).toHaveLength(1);
    expect(restoredStore.hasProcessed('WF-PERSIST-1:2')).toBe(true);
  });

  it('stores only new actual-feedback events in a batch', () => {
    const storage = new MemoryStorage();
    const store = new PersistentWorkforceIntegrationStore(storage, 'feedback-key');
    const service = new WorkforceIntegrationService(store);
    const event = {
      contractVersion: '1.0' as const,
      eventId: 'EV-1',
      eventType: 'RESULT_RECORDED' as const,
      occurredAt: '2026-09-08T13:05:00.000Z',
      mesPlanId: 'MES-1',
      mesPlanVersion: 3,
      quantityGood: 10,
      idempotencyKey: 'EV-1',
      actorId: 'op-1'
    };
    const batch = { contractVersion: '1.0' as const, sentAt: '2026-09-08T13:06:00.000Z', sourceSiteExternalId: 'SITE-1', events: [event] };

    service.validateAndAcceptActualFeedback(batch);
    service.validateAndAcceptActualFeedback(batch);

    expect(store.getActualFeedbackBatches()).toHaveLength(1);
    expect(store.getActualFeedbackBatches()[0].events).toHaveLength(1);
    expect(store.getLog()).toHaveLength(1);
  });
});
