import { MesImportReceipt, WorkforcePublishedPlanDto } from './types';
import { validatePublishedPlan } from './validator';

export interface SupabaseRpcError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface SupabaseRpcClient {
  rpc<T = unknown>(functionName: string, args: Record<string, unknown>): Promise<{
    data: T | null;
    error: SupabaseRpcError | null;
  }>;
}

export interface SupabaseWorkforceImportOptions {
  rpcFunction?: string;
}

export class SupabaseWorkforceImportAdapter {
  private readonly rpcFunction: string;

  constructor(
    private readonly client: SupabaseRpcClient,
    options: SupabaseWorkforceImportOptions = {}
  ) {
    this.rpcFunction = options.rpcFunction ?? 'mes_import_workforce_plan';
  }

  async importPublishedPlan(
    dto: WorkforcePublishedPlanDto,
    importedBy: string
  ): Promise<MesImportReceipt> {
    validatePublishedPlan(dto);
    if (!importedBy.trim()) throw new Error('importedBy обязателен');

    const { data, error } = await this.client.rpc<MesImportReceipt>(this.rpcFunction, {
      p_payload: dto,
      p_imported_by: importedBy.trim()
    });

    if (error) {
      const detail = [error.message, error.details, error.hint].filter(Boolean).join(' | ');
      throw new Error(`MES Supabase RPC ${this.rpcFunction}: ${detail || 'операция отклонена'}`);
    }
    if (!data) throw new Error(`MES Supabase RPC ${this.rpcFunction}: пустой ответ`);
    if (data.contractVersion !== dto.contractVersion || data.idempotencyKey !== dto.idempotencyKey) {
      throw new Error('MES Supabase RPC: ответ не соответствует импортированному сообщению');
    }
    if (!data.accepted) throw new Error(data.message || 'MES Supabase: план отклонён');

    return data;
  }
}
