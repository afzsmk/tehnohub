import { describe, expect, it, vi } from 'vitest';
import { InMemoryWorkforceOutboxStore, PersistentWorkforceOutboxStore, WorkforceOutboxDispatcher } from '../src/integration/workforce/outbox';
import { MesActualEventDto } from '../src/integration/workforce/types';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

function event(id: string): MesActualEventDto {
  return {
    contractVersion: '1.0',
    eventId: id,
    eventType: 'RESULT_RECORDED',
    occurredAt: '2026-09-08T14:00:00.000Z',
    mesPlanId: 'MES-1',
    mesPlanVersion: 4,
    quantityGood: 10,
    quantityScrap: 1,
    idempotencyKey: id,
    actorId: 'operator-1'
  };
}

describe('Workforce actual-feedback outbox', () => {
  it('deduplicates events and dispatches a bounded batch', async () => {
    const store = new InMemoryWorkforceOutboxStore();
    store.enqueue([event('EV-1'), event('EV-1'), event('EV-2')]);
    const sender = { sendActualFeedback: vi.fn().mockResolvedValue(undefined) };
    const dispatcher = new WorkforceOutboxDispatcher(store, sender, { batchSize: 1, sourceSiteExternalId: 'SITE-1', clock: () => '2026-09-08T14:05:00.000Z' });

    const first = await dispatcher.dispatchOnce();
    expect(first).toEqual({ sent: 1, failed: 0 });
    expect(sender.sendActualFeedback).toHaveBeenCalledTimes(1);
    expect(sender.sendActualFeedback.mock.calls[0][0].events).toHaveLength(1);
    expect(store.list('SENT')).toHaveLength(1);
    expect(store.list('PENDING')).toHaveLength(1);
  });

  it('moves failed deliveries back to a retryable state with an attempt counter', async () => {
    const store = new InMemoryWorkforceOutboxStore();
    store.enqueue([event('EV-FAIL')]);
    const sender = { sendActualFeedback: vi.fn().mockRejectedValueOnce(new Error('Workforce недоступен')) };
    const dispatcher = new WorkforceOutboxDispatcher(store, sender, { sourceSiteExternalId: 'SITE-1', clock: () => '2026-09-08T14:10:00.000Z' });

    const failed = await dispatcher.dispatchOnce();
    expect(failed).toEqual({ sent: 0, failed: 1 });
    expect(store.list('FAILED')[0].attempts).toBe(1);
    expect(store.list('FAILED')[0].lastError).toBe('Workforce недоступен');

    sender.sendActualFeedback.mockResolvedValueOnce(undefined);
    const retried = await dispatcher.dispatchOnce();
    expect(retried).toEqual({ sent: 1, failed: 0 });
    expect(store.list('SENT')[0].attempts).toBe(2);
  });

  it('persists pending and sent entries across store recreation', async () => {
    const storage = new MemoryStorage();
    const first = new PersistentWorkforceOutboxStore(storage, 'outbox-test');
    first.enqueue([event('EV-PERSIST')]);
    expect(first.list('PENDING')).toHaveLength(1);

    const restored = new PersistentWorkforceOutboxStore(storage, 'outbox-test');
    expect(restored.list('PENDING')).toHaveLength(1);
    const sender = { sendActualFeedback: vi.fn().mockResolvedValue(undefined) };
    const dispatcher = new WorkforceOutboxDispatcher(restored, sender, { sourceSiteExternalId: 'SITE-1', clock: () => '2026-09-08T14:20:00.000Z' });
    await dispatcher.dispatchOnce();

    const reloaded = new PersistentWorkforceOutboxStore(storage, 'outbox-test');
    expect(reloaded.list('SENT')).toHaveLength(1);
  });
});
