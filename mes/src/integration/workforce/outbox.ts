import { MesActualEventDto, MesActualFeedbackBatchDto } from './types';

export type WorkforceOutboxStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

export interface WorkforceOutboxEntry {
  id: string;
  idempotencyKey: string;
  event: MesActualEventDto;
  createdAt: string;
  attempts: number;
  status: WorkforceOutboxStatus;
  lastAttemptAt?: string;
  sentAt?: string;
  lastError?: string;
}

export interface WorkforceOutboxStore {
  enqueue(events: MesActualEventDto[]): void;
  claim(limit: number, now?: string): WorkforceOutboxEntry[];
  markSent(id: string, sentAt?: string): void;
  markFailed(id: string, error: string, now?: string): void;
  list(status?: WorkforceOutboxStatus): WorkforceOutboxEntry[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryWorkforceOutboxStore implements WorkforceOutboxStore {
  protected readonly entries = new Map<string, WorkforceOutboxEntry>();

  enqueue(events: MesActualEventDto[]): void {
    for (const event of events) {
      if (this.entries.has(event.idempotencyKey)) continue;
      this.entries.set(event.idempotencyKey, {
        id: `OUT-${event.idempotencyKey}`,
        idempotencyKey: event.idempotencyKey,
        event: clone(event),
        createdAt: new Date().toISOString(),
        attempts: 0,
        status: 'PENDING'
      });
    }
  }

  claim(limit: number, now = new Date().toISOString()): WorkforceOutboxEntry[] {
    const take = Math.max(0, Math.floor(limit));
    const result: WorkforceOutboxEntry[] = [];
    for (const entry of this.entries.values()) {
      if (result.length >= take) break;
      if (entry.status !== 'PENDING' && entry.status !== 'FAILED') continue;
      entry.status = 'SENDING';
      entry.attempts += 1;
      entry.lastAttemptAt = now;
      result.push(clone(entry));
    }
    return result;
  }

  markSent(id: string, sentAt = new Date().toISOString()): void {
    const entry = this.findById(id);
    entry.status = 'SENT';
    entry.sentAt = sentAt;
    entry.lastError = undefined;
  }

  markFailed(id: string, error: string, now = new Date().toISOString()): void {
    const entry = this.findById(id);
    entry.status = 'FAILED';
    entry.lastError = error;
    entry.lastAttemptAt = now;
  }

  list(status?: WorkforceOutboxStatus): WorkforceOutboxEntry[] {
    return [...this.entries.values()]
      .filter(entry => !status || entry.status === status)
      .map(clone);
  }

  protected findById(id: string): WorkforceOutboxEntry {
    const entry = [...this.entries.values()].find(item => item.id === id);
    if (!entry) throw new Error(`Outbox entry не найдена: ${id}`);
    return entry;
  }
}

export interface WorkforceOutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_WORKFORCE_OUTBOX_STORAGE_KEY = 'zsmk_mes_workforce_outbox_v1';

interface PersistedOutboxState {
  schemaVersion: 1;
  entries: WorkforceOutboxEntry[];
}

function readOutboxState(storage: WorkforceOutboxStorage, key: string): WorkforceOutboxEntry[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedOutboxState>;
    return parsed.schemaVersion === 1 && Array.isArray(parsed.entries)
      ? parsed.entries.map(clone)
      : [];
  } catch {
    return [];
  }
}

export class PersistentWorkforceOutboxStore implements WorkforceOutboxStore {
  private entries: WorkforceOutboxEntry[];

  constructor(
    private readonly storage: WorkforceOutboxStorage,
    private readonly key = DEFAULT_WORKFORCE_OUTBOX_STORAGE_KEY
  ) {
    this.entries = readOutboxState(storage, key);
  }

  enqueue(events: MesActualEventDto[]): void {
    const existing = new Set(this.entries.map(entry => entry.idempotencyKey));
    for (const event of events) {
      if (existing.has(event.idempotencyKey)) continue;
      this.entries.push({
        id: `OUT-${event.idempotencyKey}`,
        idempotencyKey: event.idempotencyKey,
        event: clone(event),
        createdAt: new Date().toISOString(),
        attempts: 0,
        status: 'PENDING'
      });
      existing.add(event.idempotencyKey);
    }
    this.persist();
  }

  claim(limit: number, now = new Date().toISOString()): WorkforceOutboxEntry[] {
    const take = Math.max(0, Math.floor(limit));
    const result: WorkforceOutboxEntry[] = [];
    for (const entry of this.entries) {
      if (result.length >= take) break;
      if (entry.status !== 'PENDING' && entry.status !== 'FAILED') continue;
      entry.status = 'SENDING';
      entry.attempts += 1;
      entry.lastAttemptAt = now;
      result.push(clone(entry));
    }
    this.persist();
    return result;
  }

  markSent(id: string, sentAt = new Date().toISOString()): void {
    const entry = this.findById(id);
    entry.status = 'SENT';
    entry.sentAt = sentAt;
    entry.lastError = undefined;
    this.persist();
  }

  markFailed(id: string, error: string, now = new Date().toISOString()): void {
    const entry = this.findById(id);
    entry.status = 'FAILED';
    entry.lastError = error;
    entry.lastAttemptAt = now;
    this.persist();
  }

  list(status?: WorkforceOutboxStatus): WorkforceOutboxEntry[] {
    return this.entries
      .filter(entry => !status || entry.status === status)
      .map(clone);
  }

  private findById(id: string): WorkforceOutboxEntry {
    const entry = this.entries.find(item => item.id === id);
    if (!entry) throw new Error(`Outbox entry не найдена: ${id}`);
    return entry;
  }

  private persist(): void {
    this.storage.setItem(this.key, JSON.stringify({ schemaVersion: 1, entries: this.entries } satisfies PersistedOutboxState));
  }
}

export function browserWorkforceOutboxStore(key = DEFAULT_WORKFORCE_OUTBOX_STORAGE_KEY): PersistentWorkforceOutboxStore {
  return new PersistentWorkforceOutboxStore(window.localStorage, key);
}

export interface WorkforceFeedbackSender {
  sendActualFeedback(dto: MesActualFeedbackBatchDto): Promise<void>;
}

export interface WorkforceOutboxDispatcherOptions {
  batchSize?: number;
  sourceSiteExternalId: string;
  clock?: () => string;
}

export class WorkforceOutboxDispatcher {
  private readonly batchSize: number;
  private readonly clock: () => string;

  constructor(
    private readonly store: WorkforceOutboxStore,
    private readonly sender: WorkforceFeedbackSender,
    private readonly options: WorkforceOutboxDispatcherOptions
  ) {
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? 50));
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async dispatchOnce(): Promise<{ sent: number; failed: number }> {
    const entries = this.store.claim(this.batchSize, this.clock());
    if (entries.length === 0) return { sent: 0, failed: 0 };

    const batch: MesActualFeedbackBatchDto = {
      contractVersion: '1.0',
      sentAt: this.clock(),
      sourceSiteExternalId: this.options.sourceSiteExternalId,
      events: entries.map(entry => entry.event)
    };

    try {
      await this.sender.sendActualFeedback(batch);
      const sentAt = this.clock();
      entries.forEach(entry => this.store.markSent(entry.id, sentAt));
      return { sent: entries.length, failed: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entries.forEach(entry => this.store.markFailed(entry.id, message, this.clock()));
      return { sent: 0, failed: entries.length };
    }
  }
}
