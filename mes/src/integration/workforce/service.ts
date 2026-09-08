import { MesActualFeedbackBatchDto, MesImportReceipt, WorkforcePublishedPlanDto, IntegrationLogEntry } from './types';
import { mapPublishedPlanToOrders } from './mapper';
import { validateActualFeedback, validatePublishedPlan } from './validator';

export interface WorkforceIntegrationStore {
  hasProcessed(key: string): boolean;
  markProcessed(key: string): void;
  appendLog(entry: IntegrationLogEntry): void;
}

export class InMemoryWorkforceIntegrationStore implements WorkforceIntegrationStore {
  private readonly processed = new Set<string>();
  readonly log: IntegrationLogEntry[] = [];

  hasProcessed(key: string): boolean {
    return this.processed.has(key);
  }

  markProcessed(key: string): void {
    this.processed.add(key);
  }

  appendLog(entry: IntegrationLogEntry): void {
    this.log.push(entry);
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
  }
}
