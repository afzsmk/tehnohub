import { describe, expect, it, vi } from 'vitest';
import { SupabaseWorkforceImportAdapter } from '../src/integration/workforce/supabase';
import { WorkforcePublishedPlanDto } from '../src/integration/workforce/types';

function plan(): WorkforcePublishedPlanDto {
  return {
    contractVersion: '1.0',
    planId: 'WF-SB-1',
    version: 7,
    status: 'PUBLISHED',
    publishedAt: '2026-09-08T14:00:00.000Z',
    publishedBy: 'planner',
    companyExternalId: 'COMPANY-ZSMK',
    siteExternalId: 'SITE-1',
    products: [{ externalId: 'P-1', code: 'P-1', name: 'Панель', unit: 'шт' }],
    professions: [],
    monthlyPlan: [{ month: '2026-10', productExternalId: 'P-1', quantity: 20 }],
    idempotencyKey: 'WF-SB-1:7'
  };
}

describe('Supabase Workforce import adapter', () => {
  it('calls the transactional RPC with the validated payload', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contractVersion: '1.0', idempotencyKey: 'WF-SB-1:7', sourcePlanId: 'WF-SB-1', sourcePlanVersion: 7,
        importedAt: '2026-09-08T14:01:00.000Z', importedBy: 'mes', accepted: true,
        message: 'План принят и импортирован'
      },
      error: null
    });
    const adapter = new SupabaseWorkforceImportAdapter({ rpc });

    const receipt = await adapter.importPublishedPlan(plan(), ' mes ');

    expect(receipt.accepted).toBe(true);
    expect(rpc).toHaveBeenCalledWith('mes_import_workforce_plan', {
      p_payload: plan(),
      p_imported_by: 'mes'
    });
  });

  it('surfaces RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS denied', code: '42501' } });
    const adapter = new SupabaseWorkforceImportAdapter({ rpc });

    await expect(adapter.importPublishedPlan(plan(), 'mes')).rejects.toThrow('RLS denied');
  });

  it('rejects a mismatched RPC receipt', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contractVersion: '1.0', idempotencyKey: 'OTHER:1', sourcePlanId: 'WF-SB-1', sourcePlanVersion: 7,
        importedAt: '2026-09-08T14:01:00.000Z', importedBy: 'mes', accepted: true
      }, error: null
    });
    const adapter = new SupabaseWorkforceImportAdapter({ rpc });

    await expect(adapter.importPublishedPlan(plan(), 'mes')).rejects.toThrow('ответ не соответствует');
  });
});
