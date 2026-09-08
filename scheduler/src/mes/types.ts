// scheduler/src/mes/types.ts

export type MesTaskStatus =
  | 'DRAFT'
  | 'PLANNED'
  | 'ASSIGNED'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'BLOCKED'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'CANCELLED';

export type MesOrderStatus =
  | 'IMPORTED'
  | 'PLANNED'
  | 'RELEASED'
  | 'IN_EXECUTION'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'BLOCKED';

export interface MesEmployee {
  id: string;
  externalId?: string;
  displayName: string;
  professionId?: string;
  active: boolean;
}

export interface MesEquipment {
  id: string;
  externalId?: string;
  name: string;
  professionId: string;
  active: boolean;
}

export interface MesTaskAssignment {
  taskId: string;
  employeeId: string;
  equipmentId?: string;
  assignedAt: string;
  releasedAt?: string;
}

export interface MesProductionTask {
  id: string;
  externalId: string;
  orderId: string;
  operationNo: number;
  professionId: string;
  quantity: number;
  plannedHours: number;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  completedQuantity: number;
  status: MesTaskStatus;
  immutableAfterCompletion: boolean;
}

export type MesProductionEventType =
  | 'TASK_CREATED'
  | 'TASK_ASSIGNED'
  | 'TASK_READY'
  | 'TASK_STARTED'
  | 'TASK_PAUSED'
  | 'TASK_BLOCKED'
  | 'TASK_PARTIAL'
  | 'TASK_COMPLETED'
  | 'TASK_CANCELLED'
  | 'QUANTITY_REPORTED'
  | 'SCRAP_REPORTED'
  | 'DOWNTIME_STARTED'
  | 'DOWNTIME_ENDED';

export interface MesProductionEvent {
  id: string;
  taskId: string;
  type: MesProductionEventType;
  occurredAt: string;
  actorId?: string;
  payload: Record<string, unknown>;
}

export interface MesDowntimeEvent {
  id: string;
  equipmentId: string;
  reasonCode: string;
  startedAt: string;
  endedAt?: string;
  minutes?: number;
  comment?: string;
}

export interface MesMaintenanceOrder {
  id: string;
  equipmentId: string;
  type: 'PPR' | 'REPAIR' | 'INSPECTION';
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  comment?: string;
}

export interface MesQualityCheck {
  id: string;
  taskId: string;
  acceptedQuantity: number;
  rejectedQuantity: number;
  defectCode?: string;
  checkedAt: string;
  inspectorId?: string;
}
