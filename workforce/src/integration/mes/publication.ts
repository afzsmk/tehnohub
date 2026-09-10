import { ScenarioData } from '../../types';

export const WORKFORCE_MES_CONTRACT_VERSION = '1.0';

export type PublishedPlanStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface WorkforceProductRef {
  externalId: string;
  code: string;
  name: string;
  unit: string;
}

export interface WorkforceProfessionRef {
  externalId: string;
  code: string;
  name: string;
}

export interface WorkforceMonthlyPlanItem {
  month: string;
  productExternalId: string;
  quantity: number;
}

export interface WorkforcePublishedPlanDto {
  contractVersion: string;
  planId: string;
  version: number;
  status: PublishedPlanStatus;
  publishedAt: string;
  publishedBy: string;
  companyExternalId: string;
  siteExternalId: string;
  products: WorkforceProductRef[];
  professions: WorkforceProfessionRef[];
  monthlyPlan: WorkforceMonthlyPlanItem[];
  idempotencyKey: string;
}

export interface MesPublicationContext {
  planId: string;
  version: number;
  publishedBy: string;
  companyExternalId: string;
  siteExternalId: string;
  publishedAt?: string;
}

function stableCode(prefix: 'PROD' | 'PROF', id: string): string {
  return `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function buildPublishedPlanDto(
  scenario: ScenarioData,
  context: MesPublicationContext
): WorkforcePublishedPlanDto {
  if (!Number.isInteger(context.version) || context.version < 1) throw new Error('version должен быть положительным целым');
  if (!context.planId.trim()) throw new Error('planId обязателен');
  if (!context.publishedBy.trim()) throw new Error('publishedBy обязателен');
  if (!context.companyExternalId.trim() || !context.siteExternalId.trim()) throw new Error('Нужны companyExternalId и siteExternalId');

  const products: WorkforceProductRef[] = scenario.products.map(product => ({
    externalId: product.id,
    code: stableCode('PROD', product.id),
    name: product.name,
    unit: product.unit
  }));

  const professions: WorkforceProfessionRef[] = scenario.professions.map(profession => ({
    externalId: profession.id,
    code: stableCode('PROF', profession.id),
    name: profession.name
  }));

  const monthlyPlan: WorkforceMonthlyPlanItem[] = [];
  scenario.products.forEach(product => {
    const quantities = scenario.plan[product.id] ?? [];
    scenario.months.forEach((month, index) => {
      const quantity = quantities[index] ?? 0;
      if (quantity !== 0) {
        monthlyPlan.push({ month: normalizeMonth(month), productExternalId: product.id, quantity });
      }
    });
  });

  const publishedAt = context.publishedAt ?? new Date().toISOString();
  const idempotencyKey = `WF:${context.planId}:${context.version}`;

  return structuredClone({
    contractVersion: WORKFORCE_MES_CONTRACT_VERSION,
    planId: context.planId,
    version: context.version,
    status: 'PUBLISHED' as const,
    publishedAt,
    publishedBy: context.publishedBy,
    companyExternalId: context.companyExternalId,
    siteExternalId: context.siteExternalId,
    products,
    professions,
    monthlyPlan,
    idempotencyKey
  });
}

function normalizeMonth(month: string): string {
  const slashMatch = /^(\d{1,2})\/(\d{2})$/.exec(month.trim());
  if (slashMatch) return `20${slashMatch[2]}-${slashMatch[1].padStart(2, '0')}`;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month.trim())) return month.trim();
  throw new Error(`Невозможно преобразовать месяц «${month}» в YYYY-MM`);
}

export function nextPublicationVersion(history: readonly Pick<WorkforcePublishedPlanDto, 'planId' | 'version'>[], planId: string): number {
  return history
    .filter(item => item.planId === planId)
    .reduce((max, item) => Math.max(max, item.version), 0) + 1;
}
