import { AppState, ScenarioData } from '../../types';
import { buildPublishedPlanDto } from './publication';
import { MesImportReceipt, WorkforcePublishedPlanDto } from './publication';

export interface MesPlanPublisher {
  publish(plan: WorkforcePublishedPlanDto): Promise<MesImportReceipt>;
}

export interface MesPublicationResult {
  dto: WorkforcePublishedPlanDto;
  receipt: MesImportReceipt;
  nextScenario: ScenarioData;
}

export interface MesPublicationOptions {
  planId?: string;
  publishedBy: string;
  companyExternalId: string;
  siteExternalId: string;
  publishedAt?: string;
}

function createPlanId(scenarioName: string): string {
  const normalized = scenarioName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `WF-${normalized || 'SCENARIO'}`;
}

export async function publishPlanForMes(
  scenario: ScenarioData,
  publisher: MesPlanPublisher,
  options: MesPublicationOptions
): Promise<MesPublicationResult> {
  const previous = scenario.mesPublication;
  const planId = options.planId?.trim() || previous?.planId?.trim();
  if (!planId) throw new Error('Нужен planId для публикации MES');

  const version = (previous?.planId === planId ? previous.version : 0) + 1;
  if (version < 1) throw new Error('Некорректная версия MES-публикации');

  const dto = buildPublishedPlanDto(scenario, {
    planId,
    version,
    publishedBy: options.publishedBy,
    companyExternalId: options.companyExternalId,
    siteExternalId: options.siteExternalId,
    publishedAt: options.publishedAt
  });

  const receipt = await publisher.publish(dto);
  if (!receipt.accepted) throw new Error(receipt.message || 'MES отклонил опубликованный план');

  const nextScenario: ScenarioData = structuredClone(scenario);
  nextScenario.mesPublication = {
    planId: dto.planId,
    version: dto.version,
    status: 'PUBLISHED',
    publishedAt: dto.publishedAt,
    publishedBy: dto.publishedBy,
    companyExternalId: dto.companyExternalId,
    siteExternalId: dto.siteExternalId
  };

  return { dto, receipt, nextScenario };
}

export function ensureMesPlanId(scenario: ScenarioData, scenarioName: string): string {
  return scenario.mesPublication?.planId?.trim() || createPlanId(scenarioName);
}

export async function publishPlanForMesInState(
  state: AppState,
  publisher: MesPlanPublisher,
  options: MesPublicationOptions & { scenarioName?: string }
): Promise<{ state: AppState; dto: WorkforcePublishedPlanDto; receipt: MesImportReceipt }> {
  const scenarioName = options.scenarioName || state.currentScenario;
  const scenario = state.scenarios[scenarioName];
  if (!scenario) throw new Error(`Сценарий «${scenarioName}» не найден`);

  const planId = options.planId || ensureMesPlanId(scenario, scenarioName);
  const result = await publishPlanForMes(scenario, publisher, { ...options, planId });
  const nextState = structuredClone(state);
  nextState.scenarios[scenarioName] = result.nextScenario;
  return { state: nextState, dto: result.dto, receipt: result.receipt };
}
