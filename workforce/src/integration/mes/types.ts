export const MES_CONTRACT_VERSION = '1.0' as const;

export type IntegrationMessageStatus = 'pending' | 'sent' | 'accepted' | 'rejected' | 'failed';

export interface WorkforcePlanPublication {
  planId: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  publishedAt?: string;
  publishedBy?: string;
}

export interface WorkforcePlanOrder {
  externalId: string;
  productExternalId: string;
  productName: string;
  unit: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  quantity: number;
  scrapPercent: number;
  plannedLaborHours: number;
  labor: Array<{
    professionExternalId: string;
    normHoursPerUnit: number;
    plannedHours: number;
  }>;
}

export interface WorkforcePublishedPlan {
  contractVersion: typeof MES_CONTRACT_VERSION;
  messageId: string;
  idempotencyKey: string;
  planId: string;
  version: number;
  scenarioId: string;
  scenarioName: string;
  publishedAt: string;
  source: {
    system: 'workforce';
    applicationVersion: string;
  };
  period: {
    from: string;
    to: string;
    labels: string[];
  };
  orders: WorkforcePlanOrder[];
}

export interface MesValidationError {
  code: string;
  message: string;
  path?: string;
}

export interface MesImportResult {
  accepted: boolean;
  messageId: string;
  importedAt?: string;
  mesPlanId?: string;
  errors?: MesValidationError[];
}

export interface MesActualLine {
  orderExternalId: string;
  productExternalId: string;
  plannedQuantity: number;
  actualQuantity: number;
  scrapQuantity: number;
  completedTasks: number;
  downtimeMinutes: number;
}

export interface MesActualReport {
  contractVersion: typeof MES_CONTRACT_VERSION;
  messageId: string;
  idempotencyKey: string;
  planId: string;
  planVersion: number;
  reportId: string;
  generatedAt: string;
  period: {
    from: string;
    to: string;
  };
  lines: MesActualLine[];
}

export interface MesDeviationLine {
  productExternalId: string;
  plannedQuantity: number;
  actualQuantity: number;
  deviationQuantity: number;
  deviationPercent: number | null;
  scrapQuantity: number;
  downtimeMinutes: number;
}

export interface MesDeviationReport {
  contractVersion: typeof MES_CONTRACT_VERSION;
  planId: string;
  planVersion: number;
  generatedAt: string;
  lines: MesDeviationLine[];
}

export interface IntegrationMessage {
  messageId: string;
  system: 'workforce' | 'mes';
  messageType: 'plan.publish' | 'actual.report';
  idempotencyKey: string;
  status: IntegrationMessageStatus;
  createdAt: string;
  sentAt?: string;
  acceptedAt?: string;
  error?: MesValidationError;
}
