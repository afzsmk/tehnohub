import { MesActualFeedbackBatchDto, MesImportReceipt, WorkforcePublishedPlanDto, IntegrationLogEntry } from './types';
import { mapPublishedPlanToOrders } from './mapper';
import { validateActualFeedback, validatePublishedPlan } from './validator';

export interface WorkforceIntegrationStore {
  hasProcessed(key: string): boolean;
  markProcessed(key: string): void;
  appendLog(entry: IntegrationLogEntry): void;
}

export interface WorkforceIntegrationHistoryStore extends WorkforceIntegrationStore {
  recordImportedPlan(dto: WorkforcePublishedPlanDto): void;
  recordActualFeedback(dto: MesActualFeedbackBatchDto): void;
}

export class InMemoryWorkforceIntegrationStore implements WorkforceIntegrationHistoryStore {
  private readonly processed = new Set<string>();
  readonly log: IntegrationLogEntry[] = [];
  readonly importedPlans: WorkforcePublishedPlanDto[] = [];
  readonly actualFeedbackBatches: MesActualFeedbackBatchDto[] = [];

  hasProcessed(key: string): boolean {
    return this.processed.has(key);
  }

  markProcessed(key: string): void {
    this.processed.add(key);
  }

  appendLog(entry: IntegrationLogEntry): void {
    this.log.push(entry);
  }

  recordImportedPlan(dto: WorkforcePublishedPlanDto): void {
    this.importedPlans.push(structuredClone(dto));
  }

  recordActualFeedback(dto: MesActualFeedbackBatchDto): void {
    this.actualFeedbackBatches.push(structuredClone(dto));
  }
}

export interface WorkforcePlanImportResult {
  receipt: MesImportReceipt;
  orders: ReturnType<typeof mapPublishedPlanToOrders>['orders'];
  warnings: string[];
}

export class WorkforceIntegrationService {
  constructor(private readonly store: WorkforceIntegrationStore) {}

  importPublishedPlan(dto: WorkforcePublishedPlanDto, importedBy: string): WorkforcePlanImportResult {
    validatePublishedPlan(dto);
    if (this.store.hasProcessed(dto.idempotencyKey)) {
      return {
        receipt: {
          contractVersion: dto.contractVersion,
          idempotencyKey: dto.idempotencyKey,
          sourcePlanId: dto.planId,
          sourcePlanVersion: dto.version,
          importedAt: new Date().toISOString(),
          importedBy,
          accepted: true,
          message: 'Повторная доставка: план уже обработан, повторная запись не выполнена'
        },
        orders: [],
        warnings: []
      };
    }

    const mapped = mapPublishedPlanToOrders(dto);
    this.store.markProcessed(dto.idempotencyKey);
    this.store.appendLog({
      direction: 'INBOUND',
      messageType: 'PLAN_PUBLISHED',
      idempotencyKey: dto.idempotencyKey,
      receivedAt: new Date().toISOString(),
      accepted: true,
      message: mapped.warnings.join('; ') || undefined
    });
    if (this.isHistoryStore(this.store)) this.store.recordImportedPlan(dto);

    return {
      receipt: {
        contractVersion: dto.contractVersion,
        idempotencyKey: dto.idempotencyKey,
        sourcePlanId: dto.planId,
        sourcePlanVersion: dto.version,
        importedAt: new Date().toISOString(),
        importedBy,
        accepted: true,
        message: mapped.warnings.length ? `Импортирован план с предупреждениями: ${mapped.warnings.length}` : 'План принят'
      },
      orders: mapped.orders,
      warnings: mapped.warnings
    };
  }

  validateAndAcceptActualFeedback(dto: MesActualFeedbackBatchDto): void {
    validateActualFeedback(dto);
    const newEvents = dto.events.filter(event => !this.store.hasProcessed(event.idempotencyKey));
    for (const event of newEvents) {
      this.store.markProcessed(event.idempotencyKey);
      this.store.appendLog({ direction: 'OUTBOUND', messageType: 'ACTUAL_FEEDBACK', idempotencyKey: event.idempotencyKey, receivedAt: new Date().toISOString(), accepted: true });
    }
    if (newEvents.length && this.isHistoryStore(this.store)) {
      this.store.recordActualFeedback({ ...structuredClone(dto), events: structuredClone(newEvents) });
    }
  }

  private isHistoryStore(store: WorkforceIntegrationStore): store is WorkforceIntegrationHistoryStore {
    return typeof (store as Partial<WorkforceIntegrationHistoryStore>).recordImportedPlan === 'function'
      && typeof (store as Partial<WorkforceIntegrationHistoryStore>).recordActualFeedback === 'function';
  }
}
