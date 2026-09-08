import { PlanPublication, ScenarioData } from '../../types';
import { MesApiClient } from './apiClient';
import { buildWorkforcePublishedPlan } from './mapper';
import { validatePublishedPlan } from './validator';
import { MesImportResult, WorkforcePublishedPlan } from './types';

export interface PublishPlanOptions {
  scenarioId: string;
  scenarioName?: string;
  applicationVersion: string;
  publishedBy?: string;
  now?: string;
}

export interface PublishPlanResult {
  publication: PlanPublication;
  payload: WorkforcePublishedPlan;
  result: MesImportResult;
}

function createPlanId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `wf-plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getNextVersion(publication?: PlanPublication): number {
  return publication ? Math.max(1, publication.version + 1) : 1;
}

export function preparePublication(data: ScenarioData, options: PublishPlanOptions): { publication: PlanPublication; payload: WorkforcePublishedPlan } {
  const publication: PlanPublication = {
    planId: data.publication?.planId || createPlanId(),
    version: getNextVersion(data.publication),
    status: 'published',
    publishedAt: options.now || new Date().toISOString(),
    publishedBy: options.publishedBy,
  };

  const payload = buildWorkforcePublishedPlan(data, {
    scenarioId: options.scenarioId,
    scenarioName: options.scenarioName,
    applicationVersion: options.applicationVersion,
    planId: publication.planId,
    version: publication.version,
    publishedAt: publication.publishedAt,
  });

  const errors = validatePublishedPlan(payload);
  if (errors.length) {
    throw new Error(`MES payload validation failed: ${errors.map(error => `${error.code}${error.path ? ` (${error.path})` : ''}`).join(', ')}`);
  }

  return { publication, payload };
}

export async function publishScenarioToMes(
  data: ScenarioData,
  apiClient: MesApiClient,
  options: PublishPlanOptions,
): Promise<PublishPlanResult> {
  const prepared = preparePublication(data, options);
  const result = await apiClient.publishPlan(prepared.payload);
  return {
    ...prepared,
    result,
  };
}
