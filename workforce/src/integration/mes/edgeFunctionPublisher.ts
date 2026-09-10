import type { MesImportReceipt, WorkforcePublishedPlanDto } from './publication';
import type { MesPlanPublisher } from './publisher';
import { supabase, isSupabaseConfigured } from '../../services/storage/supabaseClient';

export const WORKFORCE_MES_PUBLISH_FUNCTION = 'mes-publish';

export class SupabaseEdgeFunctionMesPlanPublisher implements MesPlanPublisher {
  async publish(plan: WorkforcePublishedPlanDto): Promise<MesImportReceipt> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Workforce Supabase не подключён');
    }

    const { data, error } = await supabase.functions.invoke<MesImportReceipt>(WORKFORCE_MES_PUBLISH_FUNCTION, {
      body: { plan }
    });

    if (error) {
      throw new Error(`Workforce → MES transport: ${error.message}`);
    }
    if (!data) {
      throw new Error('Workforce → MES transport: пустой ответ');
    }
    if (data.contractVersion !== plan.contractVersion || data.idempotencyKey !== plan.idempotencyKey) {
      throw new Error('Workforce → MES transport: ответ не соответствует опубликованному плану');
    }

    return data;
  }
}

export const mesPlanPublisher = new SupabaseEdgeFunctionMesPlanPublisher();
