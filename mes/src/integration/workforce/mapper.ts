import { ProductionOrder } from '../../types';
import { WorkforceMonthlyPlanItem, WorkforcePublishedPlanDto } from './types';

export interface WorkforceImportMapping {
  orders: ProductionOrder[];
  warnings: string[];
}

function priorityFromQuantity(quantity: number): ProductionOrder['priority'] {
  return quantity >= 1000 ? 'HIGH' : 'NORMAL';
}

function mapItemToOrder(plan: WorkforcePublishedPlanDto, item: WorkforceMonthlyPlanItem, index: number, product: WorkforcePublishedPlanDto['products'][number]): ProductionOrder {
  const dueAt = new Date(`${item.month}-28T23:59:59.999Z`).toISOString();
  return {
    id: `WF-${plan.planId}-${plan.version}-${index + 1}`,
    externalId: `${plan.planId}:${plan.version}:${item.month}:${item.productExternalId}`,
    number: `WF-${item.month}-${product.code}-${String(index + 1).padStart(3, '0')}`,
    productId: product.externalId,
    quantity: item.quantity,
    completedQuantity: 0,
    dueAt,
    priority: priorityFromQuantity(item.quantity),
    status: 'IMPORTED',
    route: []
  };
}

export function mapPublishedPlanToOrders(plan: WorkforcePublishedPlanDto): WorkforceImportMapping {
  const productById = new Map(plan.products.map(product => [product.externalId, product]));
  const warnings: string[] = [];
  const orders = plan.monthlyPlan.map((item, index) => {
    const product = productById.get(item.productExternalId);
    if (!product) {
      warnings.push(`Не найден продукт ${item.productExternalId}; строка ${index + 1} пропущена`);
      return undefined;
    }
    if (item.quantity === 0) {
      warnings.push(`Нулевая производственная потребность ${product.code} за ${item.month}; строка ${index + 1} пропущена`);
      return undefined;
    }
    return mapItemToOrder(plan, item, index, product);
  }).filter((order): order is ProductionOrder => Boolean(order));

  return { orders, warnings };
}
