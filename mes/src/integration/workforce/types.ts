export const WORKFORCE_MES_CONTRACT_VERSION = '1.0';

export type PublishedPlanStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ActualEventType = 'TASK_COMPLETED' | 'RESULT_RECORDED' | 'DOWNTIME' | 'MAINTENANCE';

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

export interface MesImportReceipt {
  contractVersion: string;
  idempotencyKey: string;
  sourcePlanId: string;
  sourcePlanVersion: number;
  importedAt: string;
  importedBy: string;
  accepted: boolean;
  message?: string;
}

export interface MesActualEventDto {
  contractVersion: string;
  eventId: string;
  eventType: ActualEventType;
  occurredAt: string;
  mesPlanId: string;
  mesPlanVersion: number;
  productionOrderExternalId?: string;
  taskId?: string;
  productExternalId?: string;
  quantityGood?: number;
  quantityScrap?: number;
  deviationMinutes?: number;
  deviationReason?: string;
  equipmentExternalId?: string;
  idempotencyKey: string;
  actorId: string;
}

export interface MesActualFeedbackBatchDto {
  contractVersion: string;
  sentAt: string;
  sourceSiteExternalId: string;
  events: MesActualEventDto[];
}

export interface IntegrationLogEntry {
  direction: 'INBOUND' | 'OUTBOUND';
  messageType: 'PLAN_PUBLISHED' | 'IMPORT_RECEIPT' | 'ACTUAL_FEEDBACK';
  idempotencyKey: string;
  receivedAt: string;
  accepted: boolean;
  message?: string;
}
