import { describe, expect, it } from 'vitest';
import { SupabaseMesEquipmentBlockRpc } from '../src/integration/mesEquipmentBlockRpc';

function fakeClient(response: unknown, error: unknown = null, capture?: (name: string, args: Record<string, unknown>) => void) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capture?.(name, args);
      return { data: response, error };
    }
  } as never;
}

const block = {
  id: 'EB-42',
  equipmentId: 'EQ-001',
  start: '2026-09-10T08:00:00.000Z',
  end: '2026-09-10T10:00:00.000Z',
  reason: 'MAINTENANCE' as const,
  comment: 'Плановое ТО'
};

describe('Supabase MES equipment block RPC', () => {
  it('serializes equipment block creation to the server contract', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesEquipmentBlockRpc(fakeClient({
      id: block.id,
      equipment_id: block.equipmentId,
      start_at: block.start,
      end_at: block.end,
      reason: block.reason,
      comment: block.comment
    }, null, (name, args) => { called = { name, args }; }));

    await expect(rpc.createBlock({
      equipmentId: block.equipmentId,
      start: block.start,
      end: block.end,
      reason: block.reason,
      comment: block.comment
    })).resolves.toEqual(block);

    expect(called?.name).toBe('mes_create_equipment_block');
    expect(called?.args).toEqual({
      p_equipment_id: block.equipmentId,
      p_start_at: block.start,
      p_end_at: block.end,
      p_reason: block.reason,
      p_comment: block.comment
    });
  });

  it('serializes equipment block deletion', async () => {
    let called: { name: string; args: Record<string, unknown> } | undefined;
    const rpc = new SupabaseMesEquipmentBlockRpc(fakeClient({
      id: block.id,
      equipment_id: block.equipmentId,
      start_at: block.start,
      end_at: block.end,
      reason: block.reason,
      comment: block.comment
    }, null, (name, args) => { called = { name, args }; }));

    await rpc.deleteBlock(block.id);

    expect(called?.name).toBe('mes_delete_equipment_block');
    expect(called?.args).toEqual({ p_block_id: block.id });
  });

  it('propagates RPC errors', async () => {
    const rpc = new SupabaseMesEquipmentBlockRpc(fakeClient(null, new Error('permission denied')));
    await expect(rpc.deleteBlock(block.id)).rejects.toThrow('permission denied');
  });
});
