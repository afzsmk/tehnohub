import { MesImportResult, WorkforcePublishedPlan } from './types';

export interface MesApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export class MesApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: MesApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
  }

  async publishPlan(payload: WorkforcePublishedPlan): Promise<MesImportResult> {
    return this.post<MesImportResult>('/api/v1/integrations/workforce/plans', payload, payload.idempotencyKey);
  }

  private async post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`MES returned invalid JSON (${response.status})`);
      }
    }

    if (!response.ok) {
      const serverMessage = typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `HTTP ${response.status}`;
      throw new Error(`MES integration failed: ${serverMessage}`);
    }

    return parsed as T;
  }
}
