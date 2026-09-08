import { MesActualEventDto } from './types';
import { SupabaseRpcClient, SupabaseRpcError } from './supabase';
import { WorkforceOutboxEntry, WorkforceOutboxStatus } from './outbox';

export interface SupabaseOutboxRpcClient extends SupabaseRpcClient {}

interface ClaimRow {
  id: string;
  idempotency_key: string;
  event_payload: MesActualEventDto;
  status: WorkforceOutboxStatus;
  attempts: number;
  created_at: string;
  last_attempt_at?: string;
  sent_at?: string;
  last_error?: string;
}

function rpcError(functionName: string, error: SupabaseRpcError): Error {
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' | ');
  return new Error(`MES Supabase RPC ${functionName}: ${detail || 'операция отклонена'}`);
}

export interface AsyncWorkforceOutboxStore {
  enqueue(events: MesActualEventDto[]): Promise<number>;
  claim(limit?: number): Promise<WorkforceOutboxEntry[]>;
  markSent(id: string, sentAt?: string): Promise<void>;
  markFailed(id: string, errorMessage: string): Promise<void>;
}

export interface SupabaseWorkforceOutboxOptions {
  enqueueRpcFunction?: string;
  claimRpcFunction?: string;
  sentRpcFunction?: string;
  failedRpcFunction?: string;
}

export class SupabaseWorkforceOutboxStore implements AsyncWorkforceOutboxStore {
  private readonly enqueueRpcFunction: string;
  private readonly claimRpcFunction: string;
  private readonly sentRpcFunction: string;
  private readonly failedRpcFunction: string;

  constructor(
    private readonly client: SupabaseOutboxRpcClient,
    options: SupabaseWorkforceOutboxOptions = {}
  ) {
    this.enqueueRpcFunction = options.enqueueRpcFunction ?? 'mes_enqueue_actual_feedback';
    this.claimRpcFunction = options.claimRpcFunction ?? 'mes_claim_actual_feedback_outbox';
    this.sentRpcFunction = options.sentRpcFunction ?? 'mes_mark_actual_feedback_outbox_sent';
    this.failedRpcFunction = options.failedRpcFunction ?? 'mes_mark_actual_feedback_outbox_failed';
  }

  async enqueue(events: MesActualEventDto[]): Promise<number> {
    if (events.length === 0) return 0;
    const { data, error } = await this.client.rpc<number>(this.enqueueRpcFunction, { p_events: events });
    if (error) throw rpcError(this.enqueueRpcFunction, error);
    if (typeof data !== 'number') throw new Error(`MES Supabase RPC ${this.enqueueRpcFunction}: некорректный ответ`);
    return data;
  }

  async claim(limit = 50): Promise<WorkforceOutboxEntry[]> {
    const { data, error } = await this.client.rpc<ClaimRow[]>(this.claimRpcFunction, { p_limit: limit });
    if (error) throw rpcError(this.claimRpcFunction, error);
    if (!Array.isArray(data)) throw new Error(`MES Supabase RPC ${this.claimRpcFunction}: некорректный ответ`);
    return data.map(row => ({
      id: row.id,
      idempotencyKey: row.idempotency_key,
      event: structuredClone(row.event_payload),
      createdAt: row.created_at,
      attempts: row.attempts,
      status: row.status,
      lastAttemptAt: row.last_attempt_at,
      sentAt: row.sent_at,
      lastError: row.last_error
    }));
  }

  async markSent(id: string, sentAt?: string): Promise<void> {
    const { error } = await this.client.rpc(this.sentRpcFunction, {
      p_id: id,
      p_sent_at: sentAt ?? new Date().toISOString()
    });
    if (error) throw rpcError(this.sentRpcFunction, error);
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.client.rpc(this.failedRpcFunction, {
      p_id: id,
      p_error: errorMessage
    });
    if (error) throw rpcError(this.failedRpcFunction, error);
  }
}

export type SupabaseWorkforceOutboxAdapter = SupabaseWorkforceOutboxStore;

export interface AsyncWorkforceOutboxDispatcherOptions {
  batchSize?: number;
}

export interface AsyncWorkforceFeedbackSender {
  sendActualFeedback(dto: import('./types').MesActualFeedbackBatchDto): Promise<void>;
}

export class AsyncWorkforceOutboxDispatcher {
  private readonly batchSize: number;

  constructor(
    private readonly store: AsyncWorkforceOutboxStore,
    private readonly sender: AsyncWorkforceFeedbackSender,
    options: AsyncWorkforceOutboxDispatcherOptions = {}
  ) {
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? 50));
  }

  async dispatchOnce(sourceSiteExternalId: string, sentAt = new Date().toISOString()): Promise<{ sent: number; failed: number }> {
    const entries = await this.store.claim(this.batchSize);
    if (entries.length === 0) return { sent: 0, failed: 0 };
    const batch = {
      contractVersion: '1.0' as const,
      sentAt,
      sourceSiteExternalId,
      events: entries.map(entry => entry.event)
    };

    try {
      await this.sender.sendActualFeedback(batch);
      const completedAt = new Date().toISOString();
      for (const entry of entries) await this.store.markSent(entry.id, completedAt);
      return { sent: entries.length, failed: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of entries) await this.store.markFailed(entry.id, message);
      return { sent: 0, failed: entries.length };
    }
  }
}
