import { MesActualFeedbackBatchDto, MesImportReceipt, WorkforcePublishedPlanDto } from './types';
import { validateActualFeedback, validatePublishedPlan } from './validator';

export interface WorkforceMesHttpClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  retryDelayMs?: number;
  correlationIdFactory?: () => string;
}

export type WorkforceMesApiPath =
  | '/api/mes/v1/workforce/plans'
  | '/api/mes/v1/workforce/actual-feedback';

export interface WorkforceMesHttpClient {
  importPublishedPlan(dto: WorkforcePublishedPlanDto): Promise<MesImportReceipt>;
  sendActualFeedback(dto: MesActualFeedbackBatchDto): Promise<void>;
}

function normalizedBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 425 || status === 429 || status >= 500;
}

function defaultCorrelationId(): string {
  return `mes-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function parseError(response: Response): Promise<Error> {
  let detail = '';
  try {
    const payload = await response.json() as { message?: unknown };
    if (typeof payload.message === 'string') detail = payload.message;
  } catch {
    // Keep the HTTP status when the server does not return JSON.
  }
  return new Error(`MES API ${response.status}: ${detail || response.statusText || 'запрос отклонён'}`);
}

export class WorkforceMesHttpClientImpl implements WorkforceMesHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly correlationIdFactory: () => string;

  constructor(private readonly options: WorkforceMesHttpClientOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retries = Math.max(0, Math.floor(options.retries ?? 2));
    this.retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 250));
    this.correlationIdFactory = options.correlationIdFactory ?? defaultCorrelationId;
  }

  async importPublishedPlan(dto: WorkforcePublishedPlanDto): Promise<MesImportReceipt> {
    validatePublishedPlan(dto);
    return this.request<MesImportReceipt>('/api/mes/v1/workforce/plans', dto, dto.idempotencyKey);
  }

  async sendActualFeedback(dto: MesActualFeedbackBatchDto): Promise<void> {
    validateActualFeedback(dto);
    const batchId = dto.events.length === 0
      ? `empty-${dto.sentAt}`
      : `batch-${dto.events.map(event => event.idempotencyKey).join(',')}`;
    await this.request<unknown>('/api/mes/v1/workforce/actual-feedback', dto, batchId);
  }

  private async request<T>(path: WorkforceMesApiPath, body: unknown, idempotencyKey: string): Promise<T> {
    let lastError: Error | undefined;
    const correlationId = this.correlationIdFactory();

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Idempotency-Key': idempotencyKey,
            'X-Correlation-ID': correlationId,
            ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {})
          },
          body: JSON.stringify(body)
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.retries) throw normalized;
        lastError = normalized;
        await sleep(this.retryDelayMs * 2 ** attempt);
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
      }

      const error = await parseError(response);
      if (!shouldRetry(response.status) || attempt === this.retries) throw error;
      lastError = error;
      await sleep(this.retryDelayMs * 2 ** attempt);
    }

    throw lastError ?? new Error('MES API: запрос не выполнен');
  }
}
