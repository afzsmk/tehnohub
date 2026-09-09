import { describe, expect, it, vi } from 'vitest';
import { SupabaseWorkforceOutboxStore, AsyncWorkforceOutboxDispatcher } from '../src/integration/workforce/supabaseOutbox';

const event = {
  contractVersion: '1.0' as const,
  eventId: 'EV-1',
  eventType: 'RESULT_RECORDED' as const,
  occurredAt: '2026-09-08T15:00:00.000Z',
  mesPlanId: 'MES-1',
  mesPlanVersion: 2,
  idempotencyKey: 'EV-1',
  actorId: 'operator-1',
  quantityGood: 10,
  quantityScrap: 1
};

describe('Supabase Workforce outbox adapter', () => {
  it('enqueues events and maps claimed database rows', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({
        data: [{
          id: 'uuid-1', idempotency_key: 'EV-1', event_payload: event, status: 'SENDING', attempts: 2,
          created_at: '2026-09-08T15:01:00.000Z', last_attempt_at: '2026-09-08T15:02:00.000Z'
        }],
        error: null
      });
    const store = new SupabaseWorkforceOutboxStore({ rpc });

    await expect(store.enqueue([event])).resolves.toBe(1);
    const claimed = await store.claim(10);
    expect(claimed[0]).toMatchObject({ id: 'uuid-1', idempotencyKey: 'EV-1', attempts: 2, status: 'SENDING' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'mes_enqueue_actual_feedback', { p_events: [event] });
    expect(rpc).toHaveBeenNthCalledWith(2, 'mes_claim_actual_feedback_outbox', { p_limit: 10 });
  });

  it('marks sent and failed through the corresponding RPCs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const store = new SupabaseWorkforceOutboxStore({ rpc });
    await store.markSent('uuid-1', '2026-09-08T15:03:00.000Z');
    await store.markFailed('uuid-2', 'Workforce timeout');
    expect(rpc).toHaveBeenNthCalledWith(1, 'mes_mark_actual_feedback_outbox_sent', { p_id: 'uuid-1', p_sent_at: '2026-09-08T15:03:00.000Z' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'mes_mark_actual_feedback_outbox_failed', { p_id: 'uuid-2', p_error: 'Workforce timeout' });
  });

  it('keeps failed delivery retryable through the async dispatcher', async () => {
    const store = {
      claim: vi.fn().mockResolvedValue([{ id: 'uuid-1', idempotencyKey: 'EV-1', event, createdAt: event.occurredAt, attempts: 1, status: 'SENDING' as const }]),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined)
    };
    const sender = { sendActualFeedback: vi.fn().mockRejectedValue(new Error('Workforce недоступен')) };
    const dispatcher = new AsyncWorkforceOutboxDispatcher(store, sender, { batchSize: 10 });

    await expect(dispatcher.dispatchOnce('SITE-1')).resolves.toEqual({ sent: 0, failed: 1 });
    expect(store.markFailed).toHaveBeenCalledWith('uuid-1', 'Workforce недоступен');
    expect(store.markSent).not.toHaveBeenCalled();
  });
});
