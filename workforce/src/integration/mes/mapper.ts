import { Product, Profession, ScenarioData } from '../../types';
import { MES_CONTRACT_VERSION, WorkforcePlanOrder, WorkforcePublishedPlan } from './types';

export interface BuildPublishedPlanOptions {
  scenarioId: string;
  applicationVersion: string;
  planId: string;
  version: number;
  publishedAt?: string;
  messageId?: string;
}

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getExternalId(entity: Pick<Product, 'id' | 'externalId'> | Pick<Profession, 'id' | 'externalId'>): string {
  return (entity.externalId || entity.id).trim();
}

function monthToBounds(label: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!match) return { start: label, end: label };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = `${match[1]}-${match[2]}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}` };
}

function buildOrderId(productExternalId: string, period: string): string {
  return `WF-${productExternalId}-${period}`;
}

function buildOrder(product: Product, professions: Map<string, Profession>, period: string, quantity: number): WorkforcePlanOrder {
  const productExternalId = getExternalId(product);
  const bounds = monthToBounds(period);
  const labor = Object.entries(product.norms)
    .map(([professionId, norm]) => ({ profession: professions.get(professionId), norm }))
    .filter((entry): entry is { profession: Profession; norm: number } => Boolean(entry.profession) && Number.isFinite(entry.norm) && entry.norm >= 0)
    .map(({ profession, norm }) => ({
      professionExternalId: getExternalId(profession),
      normHoursPerUnit: norm,
      plannedHours: Number((quantity * norm).toFixed(6)),
    }));

  return {
    externalId: buildOrderId(productExternalId, period),
    productExternalId,
    productName: product.name,
    unit: product.unit,
    period,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    quantity,
    scrapPercent: Number.isFinite(product.scrap) ? Math.max(0, product.scrap) : 0,
    plannedLaborHours: Number(labor.reduce((sum, item) => sum + item.plannedHours, 0).toFixed(6)),
    labor,
  };
}

export function buildWorkforcePublishedPlan(data: ScenarioData, options: BuildPublishedPlanOptions): WorkforcePublishedPlan {
  if (!options.scenarioId.trim()) throw new Error('scenarioId is required');
  if (!options.planId.trim()) throw new Error('planId is required');
  if (!Number.isInteger(options.version) || options.version < 1) throw new Error('version must be a positive integer');
  if (!data.months.length) throw new Error('scenario has no planning periods');

  const publishedAt = options.publishedAt || new Date().toISOString();
  const messageId = options.messageId || createId('wf-plan');
  const idempotencyKey = `workforce:plan:${options.planId}:v${options.version}`;
  const professions = new Map(data.professions.map(profession => [profession.id, profession]));
  const orders: WorkforcePlanOrder[] = [];

  for (const product of data.products) {
    const row = data.plan[product.id] || [];
    data.months.forEach((period, monthIndex) => {
      const quantity = Number(row[monthIndex] ?? 0);
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Invalid quantity for ${product.id} / ${period}`);
      if (quantity === 0) return;
      orders.push(buildOrder(product, professions, period, quantity));
    });
  }

  return {
    contractVersion: MES_CONTRACT_VERSION,
    messageId,
    idempotencyKey,
    planId: options.planId,
    version: options.version,
    scenarioId: options.scenarioId,
    scenarioName: data.settings.companyName || 'Workforce plan',
    publishedAt,
    source: {
      system: 'workforce',
      applicationVersion: options.applicationVersion,
    },
    period: {
      from: monthToBounds(data.months[0]).start,
      to: monthToBounds(data.months[data.months.length - 1]).end,
      labels: [...data.months],
    },
    orders,
  };
}
