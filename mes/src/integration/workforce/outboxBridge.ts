import { buildActualFeedbackBatch } from './feedback';
import { MesState } from '../../types';
import { WorkforceOutboxStore } from './outbox';

/**
 * Adds only newly-created MES production events to the outbound Workforce outbox.
 * The production event itself remains the source of truth; the outbox only tracks delivery.
 */
export function enqueueNewActualFeedbackEvents(
  state: MesState,
  previousEventCount: number,
  store: WorkforceOutboxStore,
  sourceSiteExternalId: string,
  sentAt?: string
): number {
  const batch = buildActualFeedbackBatch(state, sourceSiteExternalId, sentAt);
  if (previousEventCount < 0 || previousEventCount > batch.events.length) {
    throw new Error('Некорректная граница новых событий');
  }
  const newEvents = batch.events.slice(previousEventCount);
  store.enqueue(newEvents);
  return newEvents.length;
}
