import { describe, expect, it } from 'vitest';
import { SupabaseMesQualityRpc } from '../src/integration/mesQualityRpc';

function fakeClient(response: unknown, responseError: unknown = null, calls: Array<{ name:string; args:Record<string,unknown> }> = []) {
  return { rpc: async (name:string, args:Record<string,unknown>) => { calls.push({name,args}); return { data:response, error:responseError }; } } as never;
}

const task = {
  id:'T-1', order_id:'O-1', operation_id:'OP-1', operation_sequence:20, status:'PARTIALLY_COMPLETED',
  planned_start:'2030-01-01T08:00:00.000Z', planned_end:'2030-01-01T10:00:00.000Z', actual_start:'2030-01-01T08:01:00.000Z', actual_end:null,
  planned_quantity:100, actual_quantity:75, quality_required:true, quality_status:'PENDING', version:7
};

const inspection = {
  id:'QI-1', task_id:'T-1', inspected_at:'2030-01-01T10:01:00.000Z', inspector_id:'U-1', status:'APPROVED',
  good_quantity:75, scrap_quantity:0, defect_code:null, comment:'OK'
};

describe('Supabase MES Quality RPC', () => {
  it('requests a quality check', async () => {
    const calls: Array<{name:string;args:Record<string,unknown>}> = [];
    const rpc = new SupabaseMesQualityRpc(fakeClient(task, null, calls));
    const result = await rpc.requestQualityCheck('T-1');
    expect(calls[0]).toEqual({name:'mes_request_quality_check',args:{p_task_id:'T-1'}});
    expect(result.qualityRequired).toBe(true);
    expect(result.qualityStatus).toBe('PENDING');
    expect(result.version).toBe(7);
  });

  it('submits an approved inspection', async () => {
    const calls: Array<{name:string;args:Record<string,unknown>}> = [];
    const rpc = new SupabaseMesQualityRpc(fakeClient(inspection, null, calls));
    const result = await rpc.submitQualityInspection('T-1','APPROVED',75,0,'','OK','2030-01-01T10:01:00.000Z');
    expect(calls[0]).toEqual({name:'mes_submit_quality_inspection',args:{p_task_id:'T-1',p_status:'APPROVED',p_good_quantity:75,p_scrap_quantity:0,p_defect_code:null,p_comment:'OK',p_inspected_at:'2030-01-01T10:01:00.000Z'}});
    expect(result.status).toBe('APPROVED');
    expect(result.taskId).toBe('T-1');
  });

  it('propagates quality server errors', async () => {
    const rpc = new SupabaseMesQualityRpc(fakeClient(null, new Error('ОТК недоступно')));
    await expect(rpc.requestQualityCheck('T-1')).rejects.toThrow('ОТК недоступно');
  });
});
