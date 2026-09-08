import { EquipmentBlock, MaintenanceOrder, MesState, ProductionEvent } from '../types';

export type MaintenanceAction = 'START' | 'COMPLETE' | 'CANCEL';

const activeStatuses: MaintenanceOrder['status'][] = ['PLANNED', 'IN_PROGRESS'];

function assertEquipment(state: MesState, equipmentId: string): void {
  const equipment = state.equipment.find(item => item.id === equipmentId);
  if (!equipment || !equipment.active) throw new Error('Оборудование не найдено или отключено');
}

function assertInterval(start: string, end: string): void {
  if (!(new Date(end).getTime() > new Date(start).getTime())) throw new Error('Окончание ППР должно быть позже начала');
}

function appendEvent(state: MesState, order: MaintenanceOrder, type: ProductionEvent['type'], actorId: string, payload: Record<string, unknown>): void {
  state.events.push({
    id: `EV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    occurredAt: new Date().toISOString(),
    actorId,
    payload: {
      maintenanceOrderId: order.id,
      equipmentId: order.equipmentId,
      mesPlanId: state.plan.id,
      mesPlanVersion: state.plan.version,
      ...payload
    }
  });
}

function overlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aS = new Date(aStart).getTime();
  const aE = new Date(aEnd).getTime();
  const bS = new Date(bStart).getTime();
  const bE = new Date(bEnd).getTime();
  return aS < bE && bS < aE;
}

export function createMaintenanceOrder(state: MesState, input: Omit<MaintenanceOrder, 'id' | 'status'>, actorId: string): MaintenanceOrder {
  assertEquipment(state, input.equipmentId);
  assertInterval(input.plannedStart, input.plannedEnd);
  const collision = state.maintenance.some(item => activeStatuses.includes(item.status) && item.equipmentId === input.equipmentId && overlap(item.plannedStart, item.plannedEnd, input.plannedStart, input.plannedEnd));
  if (collision) throw new Error('На оборудовании уже есть пересекающееся ППР/ремонт');
  const order: MaintenanceOrder = { ...input, id: `MO-${Date.now()}`, status: 'PLANNED' };
  state.maintenance.push(order);
  syncMaintenanceBlock(state, order);
  appendEvent(state, order, 'MAINTENANCE_STARTED', actorId, { action: 'CREATED' });
  return order;
}

export function transitionMaintenance(state: MesState, orderId: string, action: MaintenanceAction, actorId: string): MaintenanceOrder {
  const order = state.maintenance.find(item => item.id === orderId);
  if (!order) throw new Error('ППР/ремонт не найден');
  if (action === 'START') {
    if (order.status !== 'PLANNED') throw new Error('Запустить ППР можно только из статуса PLANNED');
    order.status = 'IN_PROGRESS';
    appendEvent(state, order, 'MAINTENANCE_STARTED', actorId, { action: 'START' });
  } else if (action === 'COMPLETE') {
    if (order.status !== 'IN_PROGRESS') throw new Error('Завершить ППР можно только из статуса IN_PROGRESS');
    order.status = 'DONE';
    removeMaintenanceBlock(state, order.id);
    appendEvent(state, order, 'MAINTENANCE_COMPLETED', actorId, { action: 'COMPLETE' });
  } else {
    if (!activeStatuses.includes(order.status)) throw new Error('Отменить ППР можно только из активного статуса');
    order.status = 'CANCELLED';
    removeMaintenanceBlock(state, order.id);
    appendEvent(state, order, 'MAINTENANCE_COMPLETED', actorId, { action: 'CANCEL' });
  }
  return order;
}

export function syncMaintenanceBlock(state: MesState, order: MaintenanceOrder): EquipmentBlock {
  const existing = state.equipmentBlocks.find(item => item.id === `MB-${order.id}`);
  const block: EquipmentBlock = { id: `MB-${order.id}`, equipmentId: order.equipmentId, start: order.plannedStart, end: order.plannedEnd, reason: order.type === 'REPAIR' ? 'REPAIR' : 'MAINTENANCE', comment: `${order.type}: ${order.comment ?? ''}`.trim() };
  if (activeStatuses.includes(order.status)) {
    if (existing) Object.assign(existing, block);
    else state.equipmentBlocks.push(block);
  }
  return block;
}

export function removeMaintenanceBlock(state: MesState, maintenanceOrderId: string): void {
  state.equipmentBlocks = state.equipmentBlocks.filter(item => item.id !== `MB-${maintenanceOrderId}`);
}
