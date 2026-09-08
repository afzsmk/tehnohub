export type UserRole =
  | 'ADMIN'
  | 'PRODUCTION_MANAGER'
  | 'PLANNER'
  | 'DISPATCHER'
  | 'MASTER'
  | 'OPERATOR'
  | 'MAINTENANCE'
  | 'QUALITY'
  | 'ANALYST';

export type TaskStatus =
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

export type OrderStatus =
  | 'IMPORTED'
  | 'PLANNED'
  | 'RELEASED'
  | 'IN_EXECUTION'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'BLOCKED';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type ScheduleStatus = 'WORK' | 'OFF' | 'VACATION' | 'SICK' | 'ABSENCE';
export type EquipmentBlockReason = 'MAINTENANCE' | 'REPAIR' | 'SETUP' | 'OTHER';
export type QualityStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Product { id: string; code: string; name: string; unit: string; }
export interface Employee { id: string; personnelNo: string; name: string; profession: string; qualificationLevel: number; active: boolean; }
export interface Equipment { id: string; code: string; name: string; workCenter: string; capabilities: string[]; active: boolean; }
export interface RouteOperation { id: string; sequence: number; code: string; name: string; workCenter: string; requiredQualification?: number; requiredEquipmentIds?: string[]; setupMinutes: number; runMinutesPerUnit: number; }
export interface ShiftDefinition { id: string; name: string; startMinute: number; durationMinutes: number; }
export interface CalendarDay { date: string; isWorking: boolean; shiftIds: string[]; }
export interface EmployeeSchedule { employeeId: string; date: string; shiftIds: string[]; status: ScheduleStatus; }
export interface EquipmentBlock { id: string; equipmentId: string; start: string; end: string; reason: EquipmentBlockReason; comment?: string; }
export interface ProductionOrder { id: string; externalId?: string; number: string; productId: string; quantity: number; completedQuantity: number; dueAt: string; priority: Priority; status: OrderStatus; route: RouteOperation[]; }
export interface ProductionTask {
  id: string;
  orderId: string;
  operationId: string;
  operationSequence: number;
  status: TaskStatus;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  plannedQuantity: number;
  actualQuantity: number;
  assignedEmployeeIds: string[];
  assignedEquipmentIds: string[];
  qualityRequired: boolean;
  qualityStatus: QualityStatus;
  version: number;
}
export interface DowntimeEvent { id: string; equipmentId: string; reasonCode: string; startedAt: string; endedAt?: string; comment?: string; }
export interface MaintenanceOrder { id: string; equipmentId: string; type: 'PM' | 'REPAIR' | 'INSPECTION'; plannedStart: string; plannedEnd: string; status: 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'; comment?: string; }
export interface ProductionResult { id: string; taskId: string; recordedAt: string; goodQuantity: number; scrapQuantity: number; employeeIds: string[]; equipmentIds: string[]; comment?: string; }
export interface ProductionEvent {
  id: string;
  taskId?: string;
  type: 'TASK_STARTED'|'TASK_PAUSED'|'TASK_RESUMED'|'TASK_COMPLETED'|'RESULT_RECORDED'|'DOWNTIME_STARTED'|'DOWNTIME_ENDED'|'MAINTENANCE_STARTED'|'MAINTENANCE_COMPLETED';
  occurredAt: string;
  actorId: string;
  payload: Record<string, unknown>;
}
export interface OperationalPlan { id: string; version: number; horizonStart: string; horizonEnd: string; status: 'DRAFT'|'RELEASED'|'ARCHIVED'; sourcePlanId?: string; sourcePlanVersion?: number; }
export interface MesState { plan: OperationalPlan; products: Product[]; employees: Employee[]; equipment: Equipment[]; shifts: ShiftDefinition[]; calendar: CalendarDay[]; employeeSchedules: EmployeeSchedule[]; equipmentBlocks: EquipmentBlock[]; orders: ProductionOrder[]; tasks: ProductionTask[]; downtimes: DowntimeEvent[]; maintenance: MaintenanceOrder[]; results: ProductionResult[]; events: ProductionEvent[]; }
