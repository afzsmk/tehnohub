import { MesActualFeedbackBatchDto, WorkforcePublishedPlanDto } from './types';
import { WorkforceIntegrationService } from './service';

const PLAN_PATH = '/api/mes/v1/workforce/plans';
const FEEDBACK_PATH = '/api/mes/v1/workforce/actual-feedback';

export interface WorkforceMesApiOptions {
  service: WorkforceIntegrationService;
  actorHeader?: string;
  idempotencyHeader?: string;
  correlationHeader?: string;
  expectedBearerToken?: string;
}

function jsonResponse(body: unknown, status = 200, correlationId?: string, correlationHeader = 'x-correlation-id'): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (correlationId) headers[correlationHeader] = correlationId;
  return new Response(JSON.stringify(body), { status, headers });
}

function correlationId(request: Request, header: string): string {
  return request.headers.get(header)?.trim() || `corr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error('Некорректный JSON в теле запроса');
  }
}

export function createWorkforceMesApi(options: WorkforceMesApiOptions) {
  const actorHeader = options.actorHeader ?? 'x-actor-id';
  const idempotencyHeader = options.idempotencyHeader ?? 'idempotency-key';
  const correlationHeader = options.correlationHeader ?? 'x-correlation-id';

  return async function handle(request: Request): Promise<Response> {
    const requestCorrelationId = correlationId(request, correlationHeader);
    if (request.method !== 'POST') return jsonResponse({ message: 'Метод не поддерживается' }, 405, requestCorrelationId, correlationHeader);

    if (options.expectedBearerToken) {
      const authorization = request.headers.get('authorization')?.trim();
      if (authorization !== `Bearer ${options.expectedBearerToken}`) return jsonResponse({ message: 'Требуется авторизация' }, 401, requestCorrelationId, correlationHeader);
    }

    try {
      if (request.url.endsWith(PLAN_PATH)) {
        const dto = await readJson<WorkforcePublishedPlanDto>(request);
        const headerKey = request.headers.get(idempotencyHeader)?.trim();
        if (headerKey && headerKey !== dto.idempotencyKey) throw new Error('Idempotency-Key не совпадает с dto.idempotencyKey');
        const importedBy = request.headers.get(actorHeader)?.trim() || dto.publishedBy;
        const result = options.service.importPublishedPlan(dto, importedBy);
        return jsonResponse(result.receipt, 202, requestCorrelationId, correlationHeader);
      }

      if (request.url.endsWith(FEEDBACK_PATH)) {
        const dto = await readJson<MesActualFeedbackBatchDto>(request);
        options.service.validateAndAcceptActualFeedback(dto);
        return jsonResponse({ contractVersion: dto.contractVersion, sourceSiteExternalId: dto.sourceSiteExternalId, accepted: true, eventCount: dto.events.length }, 202, requestCorrelationId, correlationHeader);
      }

      return jsonResponse({ message: 'Endpoint не найден' }, 404, requestCorrelationId, correlationHeader);
    } catch (error) {
      return jsonResponse({ message: error instanceof Error ? error.message : 'Запрос отклонён' }, 400, requestCorrelationId, correlationHeader);
    }
  };
}
