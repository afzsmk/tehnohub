import { MES_CONTRACT_VERSION, WorkforcePublishedPlan, MesActualReport, MesValidationError } from './types';

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function validatePublishedPlan(payload: WorkforcePublishedPlan): MesValidationError[] {
  const errors: MesValidationError[] = [];

  if (payload.contractVersion !== MES_CONTRACT_VERSION) {
    errors.push({ code: 'CONTRACT_VERSION', message: 'Неподдерживаемая версия интеграционного контракта.', path: 'contractVersion' });
  }
  if (!payload.planId.trim()) {
    errors.push({ code: 'PLAN_ID_REQUIRED', message: 'Не задан идентификатор плана.', path: 'planId' });
  }
  if (!Number.isInteger(payload.version) || payload.version < 1) {
    errors.push({ code: 'PLAN_VERSION_INVALID', message: 'Версия плана должна быть положительным целым числом.', path: 'version' });
  }
  if (!payload.scenarioId.trim()) {
    errors.push({ code: 'SCENARIO_ID_REQUIRED', message: 'Не задан идентификатор сценария.', path: 'scenarioId' });
  }
  if (!Array.isArray(payload.period.labels) || payload.period.labels.length === 0) {
    errors.push({ code: 'PERIOD_EMPTY', message: 'Период публикации не содержит ни одного периода.', path: 'period.labels' });
  }
  if (!Array.isArray(payload.orders)) {
    errors.push({ code: 'ORDERS_INVALID', message: 'Раздел заказов должен быть массивом.', path: 'orders' });
    return errors;
  }

  const externalIds = new Set<string>();
  payload.orders.forEach((order, index) => {
    const path = `orders[${index}]`;
    if (!order.externalId.trim()) errors.push({ code: 'ORDER_ID_REQUIRED', message: 'Не задан внешний идентификатор заказа.', path: `${path}.externalId` });
    if (externalIds.has(order.externalId)) errors.push({ code: 'ORDER_ID_DUPLICATE', message: 'В публикации обнаружен повторяющийся внешний идентификатор заказа.', path: `${path}.externalId` });
    externalIds.add(order.externalId);
    if (!order.productExternalId.trim()) errors.push({ code: 'PRODUCT_ID_REQUIRED', message: 'Не задан внешний идентификатор изделия.', path: `${path}.productExternalId` });
    if (!order.period.trim()) errors.push({ code: 'ORDER_PERIOD_REQUIRED', message: 'Не задан период заказа.', path: `${path}.period` });
    if (!isFiniteNonNegative(order.quantity)) errors.push({ code: 'QUANTITY_INVALID', message: 'Количество должно быть неотрицательным числом.', path: `${path}.quantity` });
    if (!isFiniteNonNegative(order.scrapPercent)) errors.push({ code: 'SCRAP_INVALID', message: 'Процент брака должен быть неотрицательным числом.', path: `${path}.scrapPercent` });
    if (!isFiniteNonNegative(order.plannedLaborHours)) errors.push({ code: 'LABOR_INVALID', message: 'Плановая трудоёмкость должна быть неотрицательным числом.', path: `${path}.plannedLaborHours` });
    order.labor.forEach((labor, laborIndex) => {
      if (!labor.professionExternalId.trim()) errors.push({ code: 'PROFESSION_ID_REQUIRED', message: 'Не задан внешний идентификатор профессии.', path: `${path}.labor[${laborIndex}].professionExternalId` });
      if (!isFiniteNonNegative(labor.normHoursPerUnit)) errors.push({ code: 'NORM_INVALID', message: 'Норма времени должна быть неотрицательным числом.', path: `${path}.labor[${laborIndex}].normHoursPerUnit` });
      if (!isFiniteNonNegative(labor.plannedHours)) errors.push({ code: 'PLANNED_HOURS_INVALID', message: 'Плановые часы должны быть неотрицательным числом.', path: `${path}.labor[${laborIndex}].plannedHours` });
    });
  });

  return errors;
}

export function validateActualReport(payload: MesActualReport): MesValidationError[] {
  const errors: MesValidationError[] = [];
  if (payload.contractVersion !== MES_CONTRACT_VERSION) errors.push({ code: 'CONTRACT_VERSION', message: 'Неподдерживаемая версия интеграционного контракта.', path: 'contractVersion' });
  if (!payload.planId.trim()) errors.push({ code: 'PLAN_ID_REQUIRED', message: 'Не задан идентификатор плана.', path: 'planId' });
  if (!Number.isInteger(payload.planVersion) || payload.planVersion < 1) errors.push({ code: 'PLAN_VERSION_INVALID', message: 'Версия плана должна быть положительным целым числом.', path: 'planVersion' });

  payload.lines.forEach((line, index) => {
    const path = `lines[${index}]`;
    if (!line.orderExternalId.trim()) errors.push({ code: 'ORDER_ID_REQUIRED', message: 'Не задан внешний идентификатор заказа.', path: `${path}.orderExternalId` });
    if (!line.productExternalId.trim()) errors.push({ code: 'PRODUCT_ID_REQUIRED', message: 'Не задан внешний идентификатор изделия.', path: `${path}.productExternalId` });
    if (!isFiniteNonNegative(line.plannedQuantity)) errors.push({ code: 'PLANNED_QTY_INVALID', message: 'Плановое количество должно быть неотрицательным числом.', path: `${path}.plannedQuantity` });
    if (!isFiniteNonNegative(line.actualQuantity)) errors.push({ code: 'ACTUAL_QTY_INVALID', message: 'Фактическое количество должно быть неотрицательным числом.', path: `${path}.actualQuantity` });
    if (!isFiniteNonNegative(line.scrapQuantity)) errors.push({ code: 'SCRAP_QTY_INVALID', message: 'Количество брака должно быть неотрицательным числом.', path: `${path}.scrapQuantity` });
    if (!Number.isInteger(line.completedTasks) || line.completedTasks < 0) errors.push({ code: 'TASKS_INVALID', message: 'Число завершённых заданий должно быть целым неотрицательным числом.', path: `${path}.completedTasks` });
    if (!Number.isInteger(line.downtimeMinutes) || line.downtimeMinutes < 0) errors.push({ code: 'DOWNTIME_INVALID', message: 'Простой должен быть целым неотрицательным числом минут.', path: `${path}.downtimeMinutes` });
  });

  return errors;
}
