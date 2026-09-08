import { MesActualEventDto, MesActualFeedbackBatchDto, WORKFORCE_MES_CONTRACT_VERSION } from './types';
import { MesState, ProductionEvent, ProductionResult } from '../../types';

function resultForEvent(state: MesState, event: ProductionEvent): ProductionResult | undefined {
  if (event.type !== 'RESULT_RECORDED') return undefined;
  const resultId = typeof event.payload.resultId === 'string' ? event.payload.resultId : undefined;
  return state.results.find(result => result.id === resultId) ?? state.results.at(-1);
}

function taskContext(state: MesState, event: ProductionEvent) {
  if (!event.taskId) return undefined;
  const task = state.tasks.find(item => item.id === event.taskId);
  if (!task) return undefined;
  const order = state.orders.find(item => item.id === task.orderId);
  const product = order ? state.products.find(item => item.id === order.productId) : undefined;
  const equipmentExternalId = task.assignedEquipmentIds[0];
  return {
    task,
    order,
    productExternalId: product?.id,
    equipmentExternalId
  };
}

function mapEvent(state: MesState, event: ProductionEvent): MesActualEventDto | undefined {
  const context = taskContext(state, event);
  const result = resultForEvent(state, event);
  const type: MesActualEventDto['eventType'] = event.type === 'TASK_COMPLETED'
    ? 'TASK_COMPLETED'
    : event.type === 'RESULT_RECORDED'
      ? 'RESULT_RECORDED'
      : event.type.startsWith('MAINTENANCE_')
        ? 'MAINTENANCE'
        : event.type.startsWith('DOWNTIME_')
          ? 'DOWNTIME'
          : undefined;
  if (!type) return undefined;
  return {
    contractVersion: WORKFORCE_MES_CONTRACT_VERSION,
    eventId: event.id,
    eventType: type,
    occurredAt: event.occurredAt,
    mesPlanId: state.plan.id,
    mesPlanVersion: state.plan.version,
    productionOrderExternalId: context?.order?.externalId ?? context?.order?.id,
    taskId: event.taskId,
    productExternalId: context?.productExternalId,
    quantityGood: result?.goodQuantity,
    quantityScrap: result?.scrapQuantity,
    equipmentExternalId: context?.equipmentExternalId,
    idempotencyKey: event.id,
    actorId: event.actorId
  };
}

export function buildActualFeedbackBatch(state: MesState, sourceSiteExternalId: string, sentAt = new Date().toISOString()): MesActualFeedbackBatchDto {
  const events = state.events.map(event => mapEvent(state, event)).filter((event): event is MesActualEventDto => Boolean(event));
  return {
    contractVersion: WORKFORCE_MES_CONTRACT_VERSION,
    sentAt,
    sourceSiteExternalId,
    events
  };
}
