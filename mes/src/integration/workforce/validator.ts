import {
  MesActualFeedbackBatchDto,
  MesActualEventDto,
  WorkforcePublishedPlanDto,
  WORKFORCE_MES_CONTRACT_VERSION
} from './types';

const isNonEmpty = (value: string): boolean => typeof value === 'string' && value.trim().length > 0;

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} должно быть неотрицательным числом`);
}

export function validatePublishedPlan(dto: WorkforcePublishedPlanDto): void {
  if (dto.contractVersion !== WORKFORCE_MES_CONTRACT_VERSION) throw new Error('Неподдерживаемая версия интеграционного контракта');
  if (!isNonEmpty(dto.planId)) throw new Error('planId обязателен');
  if (!Number.isInteger(dto.version) || dto.version < 1) throw new Error('version должен быть положительным целым');
  if (dto.status !== 'PUBLISHED') throw new Error('В MES принимаются только опубликованные планы');
  if (!isNonEmpty(dto.publishedAt) || Number.isNaN(new Date(dto.publishedAt).getTime())) throw new Error('Некорректный publishedAt');
  if (!isNonEmpty(dto.publishedBy) || !isNonEmpty(dto.companyExternalId) || !isNonEmpty(dto.siteExternalId)) throw new Error('Не заполнены обязательные идентификаторы публикации');
  if (!isNonEmpty(dto.idempotencyKey)) throw new Error('idempotencyKey обязателен');

  const productIds = new Set<string>();
  for (const product of dto.products) {
    if (!isNonEmpty(product.externalId) || !isNonEmpty(product.code) || !isNonEmpty(product.name) || !isNonEmpty(product.unit)) throw new Error('Некорректная ссылка на продукт');
    if (productIds.has(product.externalId)) throw new Error(`Дублируется product.externalId: ${product.externalId}`);
    productIds.add(product.externalId);
  }

  const professionIds = new Set<string>();
  for (const profession of dto.professions) {
    if (!isNonEmpty(profession.externalId) || !isNonEmpty(profession.code) || !isNonEmpty(profession.name)) throw new Error('Некорректная ссылка на профессию');
    if (professionIds.has(profession.externalId)) throw new Error(`Дублируется profession.externalId: ${profession.externalId}`);
    professionIds.add(profession.externalId);
  }

  for (const item of dto.monthlyPlan) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)) throw new Error(`Некорректный month: ${item.month}`);
    if (!productIds.has(item.productExternalId)) throw new Error(`План ссылается на неизвестный продукт: ${item.productExternalId}`);
    assertFiniteNonNegative(item.quantity, 'quantity');
  }
}

function validateActualEvent(event: MesActualEventDto): void {
  if (event.contractVersion !== WORKFORCE_MES_CONTRACT_VERSION) throw new Error(`Неподдерживаемая версия контракта для события ${event.eventId}`);
  if (!isNonEmpty(event.eventId) || !isNonEmpty(event.idempotencyKey) || !isNonEmpty(event.actorId)) throw new Error('Событие должно иметь eventId, idempotencyKey и actorId');
  if (!isNonEmpty(event.mesPlanId) || !Number.isInteger(event.mesPlanVersion) || event.mesPlanVersion < 1) throw new Error('Некорректная ссылка на MES-план');
  if (!isNonEmpty(event.occurredAt) || Number.isNaN(new Date(event.occurredAt).getTime())) throw new Error('Некорректный occurredAt');
  if (event.quantityGood !== undefined) assertFiniteNonNegative(event.quantityGood, 'quantityGood');
  if (event.quantityScrap !== undefined) assertFiniteNonNegative(event.quantityScrap, 'quantityScrap');
  if (event.deviationMinutes !== undefined && !Number.isFinite(event.deviationMinutes)) throw new Error('deviationMinutes должно быть числом');
}

export function validateActualFeedback(dto: MesActualFeedbackBatchDto): void {
  if (dto.contractVersion !== WORKFORCE_MES_CONTRACT_VERSION) throw new Error('Неподдерживаемая версия интеграционного контракта');
  if (!isNonEmpty(dto.sourceSiteExternalId)) throw new Error('sourceSiteExternalId обязателен');
  if (!isNonEmpty(dto.sentAt) || Number.isNaN(new Date(dto.sentAt).getTime())) throw new Error('Некорректный sentAt');
  const ids = new Set<string>();
  for (const event of dto.events) {
    validateActualEvent(event);
    if (ids.has(event.idempotencyKey)) throw new Error(`Дублируется idempotencyKey события: ${event.idempotencyKey}`);
    ids.add(event.idempotencyKey);
  }
}
