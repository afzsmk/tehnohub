import { buildActualFeedbackBatch } from './feedback';
import { MesState } from '../../types';
import { WorkforceOutboxStore } from './outbox';

/** Enqueue newly created, exportable MES events without depending on array position. */
export function enqueueNewActualFeedbackEvents(
  state: MesState,
  previousEventIds: ReadonlySet<string>,
  store: WorkforceOutboxStore,
  sourceSiteExternalId: string,
  sentAt?: string
): number {
  const batch = buildActualFeedbackBatch(state, sourceSiteExternalId, sentAt);
  const newEvents = batch.events.filter(event => !previousEventIds.has(event.eventId));
  store.enqueue(newEvents);
  return newEvents.length;
}
