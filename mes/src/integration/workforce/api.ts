import { MesActualFeedbackBatchDto, WorkforcePublishedPlanDto } from './types';
import { WorkforceIntegrationService } from './service';

const PLAN_PATH = '/api/mes/v1/workforce/plans';
const FEEDBACK_PATH = '/api/mes/v1/workforce/actual-feedback';

export interface WorkforceMesApiOptions {
  service: WorkforceIntegrationService;
  actorHeader?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
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

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return jsonResponse({ message: 'Метод не поддерживается' }, 405);

    try {
      if (request.url.endsWith(PLAN_PATH)) {
        const dto = await readJson<WorkforcePublishedPlanDto>(request);
        const importedBy = request.headers.get(actorHeader)?.trim() || dto.publishedBy;
        const result = options.service.importPublishedPlan(dto, importedBy);
        return jsonResponse(result.receipt, 202);
      }

      if (request.url.endsWith(FEEDBACK_PATH)) {
        const dto = await readJson<MesActualFeedbackBatchDto>(request);
        options.service.validateAndAcceptActualFeedback(dto);
        return jsonResponse({
          contractVersion: dto.contractVersion,
          sourceSiteExternalId: dto.sourceSiteExternalId,
          accepted: true,
          eventCount: dto.events.length
        }, 202);
      }

      return jsonResponse({ message: 'Endpoint не найден' }, 404);
    } catch (error) {
      return jsonResponse({ message: error instanceof Error ? error.message : 'Запрос отклонён' }, 400);
    }
  };
}
