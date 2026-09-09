import type { SupabaseClient } from '@supabase/supabase-js';
import type { EquipmentBlock, EquipmentBlockReason } from '../types';

interface DbEquipmentBlock {
  id: string;
  equipment_id: string;
  start_at: string;
  end_at: string;
  reason: EquipmentBlockReason;
  comment: string | null;
}

function row<T>(data: unknown, name: string): T {
  if (!data) throw new Error(`MES RPC ${name} вернул пустой результат`);
  return data as T;
}

function mapBlock(r: DbEquipmentBlock): EquipmentBlock {
  return {
    id: r.id,
    equipmentId: r.equipment_id,
    start: r.start_at,
    end: r.end_at,
    reason: r.reason,
    comment: r.comment ?? undefined
  };
}

export class SupabaseMesEquipmentBlockRpc {
  constructor(private readonly client: SupabaseClient) {}

  async createBlock(block: Omit<EquipmentBlock, 'id'>): Promise<EquipmentBlock> {
    const { data, error } = await this.client.rpc('mes_create_equipment_block', {
      p_equipment_id: block.equipmentId,
      p_start_at: block.start,
      p_end_at: block.end,
      p_reason: block.reason,
      p_comment: block.comment ?? null
    });
    if (error) throw error;
    return mapBlock(row<DbEquipmentBlock>(data, 'mes_create_equipment_block'));
  }

  async deleteBlock(blockId: string): Promise<EquipmentBlock> {
    const { data, error } = await this.client.rpc('mes_delete_equipment_block', {
      p_block_id: blockId
    });
    if (error) throw error;
    return mapBlock(row<DbEquipmentBlock>(data, 'mes_delete_equipment_block'));
  }
}
