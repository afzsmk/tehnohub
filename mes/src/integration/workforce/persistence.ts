import { IntegrationLogEntry, MesActualFeedbackBatchDto, WorkforcePublishedPlanDto } from './types';
import type { WorkforceIntegrationStore } from './service';

export interface WorkforceIntegrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PersistenceState {
  schemaVersion: 1;
  processedKeys: string[];
  log: IntegrationLogEntry[];
  importedPlans: WorkforcePublishedPlanDto[];
  actualFeedbackBatches: MesActualFeedbackBatchDto[];
}

export const DEFAULT_WORKFORCE_INTEGRATION_STORAGE_KEY = 'zsmk_mes_workforce_integration_v1';

function emptyState(): PersistenceState {
  return { schemaVersion: 1, processedKeys: [], log: [], importedPlans: [], actualFeedbackBatches: [] };
}

function readState(storage: WorkforceIntegrationStorage, key: string): PersistenceState {
  try {
    const raw = storage.getItem(key);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<PersistenceState>;
    if (parsed.schemaVersion !== 1) return emptyState();
    return {
      schemaVersion: 1,
      processedKeys: Array.isArray(parsed.processedKeys) ? parsed.processedKeys.filter((item): item is string => typeof item === 'string') : [],
      log: Array.isArray(parsed.log) ? parsed.log as IntegrationLogEntry[] : [],
      importedPlans: Array.isArray(parsed.importedPlans) ? parsed.importedPlans as WorkforcePublishedPlanDto[] : [],
      actualFeedbackBatches: Array.isArray(parsed.actualFeedbackBatches) ? parsed.actualFeedbackBatches as MesActualFeedbackBatchDto[] : []
    };
  } catch {
    return emptyState();
  }
}

export class PersistentWorkforceIntegrationStore implements WorkforceIntegrationStore {
  private state: PersistenceState;

  constructor(
    private readonly storage: WorkforceIntegrationStorage,
    private readonly key = DEFAULT_WORKFORCE_INTEGRATION_STORAGE_KEY
  ) {
    this.state = readState(storage, key);
  }

  hasProcessed(key: string): boolean { return this.state.processedKeys.includes(key); }

  markProcessed(key: string): void {
    if (this.hasProcessed(key)) return;
    this.state.processedKeys.push(key);
    this.persist();
  }

  appendLog(entry: IntegrationLogEntry): void {
    this.state.log.push({ ...entry });
    this.persist();
  }

  recordImportedPlan(dto: WorkforcePublishedPlanDto): void {
    this.state.importedPlans.push(structuredClone(dto));
    this.persist();
  }

  recordActualFeedback(dto: MesActualFeedbackBatchDto): void {
    this.state.actualFeedbackBatches.push(structuredClone(dto));
    this.persist();
  }

  getLog(): IntegrationLogEntry[] { return structuredClone(this.state.log); }
  getImportedPlans(): WorkforcePublishedPlanDto[] { return structuredClone(this.state.importedPlans); }
  getActualFeedbackBatches(): MesActualFeedbackBatchDto[] { return structuredClone(this.state.actualFeedbackBatches); }

  private persist(): void {
    this.storage.setItem(this.key, JSON.stringify(this.state));
  }
}

export function browserWorkforceIntegrationStore(key = DEFAULT_WORKFORCE_INTEGRATION_STORAGE_KEY): PersistentWorkforceIntegrationStore {
  return new PersistentWorkforceIntegrationStore(window.localStorage, key);
}
