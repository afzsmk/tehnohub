import { describe, expect, it } from 'vitest';
import { InMemoryWorkforceOutboxStore, WorkforceOutboxDispatcher } from './outbox';
import type { MesActualEventDto } from './types';

function event(id: string): MesActualEventDto {
  return {
    contractVersion: '1.0',
    eventId: id,
    eventType: 'RESULT_RECORDED',
    occurredAt: '2026-09-08T10:00:00.000Z',
    mesPlanId: 'PLAN-1',
    mesPlanVersion: 3,
    productionOrderExternalId: 'ORDER-1',
    taskId: 'TASK-1',
    productExternalId: 'PRODUCT-1',
    quantityGood: 10,
    quantityScrap: 1,
    equipmentExternalId: 'EQ-1',
    idempotencyKey: id,
    actorId: 'USER-1'
  };
}

describe('WorkforceOutboxDispatcher', () => {
  it('sends claimed events and marks them SENT', async () => {
    const store = new InMemoryWorkforceOutboxStore();
    store.enqueue([event('EV-1'), event('EV-2'), event('EV-2')]);
    let sentEvents: MesActualEventDto[] = [];

    const dispatcher = new WorkforceOutboxDispatcher(
      store,
      { sendActualFeedback: async batch => { sentEvents = batch.events; } },
      { sourceSiteExternalId: 'SITE-1', batchSize: 50, clock: () => '2026-09-08T10:05:00.000Z' }
    );

    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ sent: 2, failed: 0 });
    expect(sentEvents.map(item => item.idempotencyKey)).toEqual(['EV-1', 'EV-2']);
    expect(store.list('SENT')).toHaveLength(2);
    expect(store.list('PENDING')).toHaveLength(0);
  });

  it('keeps events FAILED for retry when Workforce is unavailable', async () => {
    const store = new InMemoryWorkforceOutboxStore();
    store.enqueue([event('EV-3')]);

    const dispatcher = new WorkforceOutboxDispatcher(
      store,
      { sendActualFeedback: async () => { throw new Error('Workforce unavailable'); } },
      { sourceSiteExternalId: 'SITE-1', clock: () => '2026-09-08T10:06:00.000Z' }
    );

    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(store.list('FAILED')).toHaveLength(1);
    expect(store.list('FAILED')[0]?.lastError).toBe('Workforce unavailable');

    const retry = store.claim(10, '2026-09-08T10:07:00.000Z');
    expect(retry).toHaveLength(1);
    expect(retry[0]?.attempts).toBe(2);
  });
});
