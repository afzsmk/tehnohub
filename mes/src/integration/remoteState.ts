import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarDay, DowntimeEvent, Employee, EmployeeSchedule, Equipment, MaintenanceOrder, MesState, ProductionEvent, ProductionOrder, ProductionResult, ProductionTask, Product, RouteOperation, ShiftDefinition } from '../types';

export interface RemoteSnapshot {
  plan: MesState['plan'];
  products: Product[];
  employees: Employee[];
  equipment: Equipment[];
  shifts: ShiftDefinition[];
  calendar: CalendarDay[];
  employeeSchedules: EmployeeSchedule[];
  orders: ProductionOrder[];
  tasks: ProductionTask[];
  downtimes: DowntimeEvent[];
  maintenance: MaintenanceOrder[];
  results: ProductionResult[];
  events: ProductionEvent[];
}

function rows(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : []; }
function str(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function num(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function bool(value: unknown, fallback = false): boolean { return typeof value === 'boolean' ? value : fallback; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }

async function selectAll(client: SupabaseClient, table: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await client.from(table).select('*');
  if (error) throw error;
  return rows(data);
}

function buildRoutes(routeRows: Array<Record<string, unknown>>): Map<string, RouteOperation[]> {
  const grouped = new Map<string, RouteOperation[]>();
  for (const row of routeRows) {
    const productId = str(row.product_id);
    const operation: RouteOperation = {
      id: str(row.id),
      sequence: num(row.sequence),
      code: str(row.code),
      name: str(row.name),
      workCenter: str(row.work_center),
      requiredQualification: row.required_qualification == null ? undefined : num(row.required_qualification),
      requiredEquipmentIds: stringArray(row.required_equipment_ids),
      setupMinutes: num(row.setup_minutes),
      runMinutesPerUnit: num(row.run_minutes_per_unit)
    };
    if (!productId || !operation.id || !operation.sequence) continue;
    const route = grouped.get(productId) ?? [];
    route.push(operation);
    grouped.set(productId, route);
  }
  for (const route of grouped.values()) route.sort((a, b) => a.sequence - b.sequence);
  return grouped;
}

function fallbackRoutesByOrder(tasks: ProductionTask[]): Map<string, RouteOperation[]> {
  const grouped = new Map<string, RouteOperation[]>();
  for (const task of tasks) {
    const route = grouped.get(task.orderId) ?? [];
    if (!route.some(operation => operation.id === task.operationId)) {
      route.push({
        id: task.operationId,
        sequence: task.operationSequence,
        code: task.operationId,
        name: task.operationId,
        workCenter: '—',
        setupMinutes: 0,
        runMinutesPerUnit: task.plannedQuantity > 0
          ? Math.max(0, (new Date(task.plannedEnd).getTime() - new Date(task.plannedStart).getTime()) / 60000 / task.plannedQuantity)
          : 0
      });
    }
    grouped.set(task.orderId, route);
  }
  for (const route of grouped.values()) route.sort((a, b) => a.sequence - b.sequence);
  return grouped;
}

export async function loadMesStateFromSupabase(client: SupabaseClient, fallback: MesState): Promise<RemoteSnapshot> {
  const [plans, productsRows, employeeRows, equipmentRows, shiftRows, calendarRows, scheduleRows, orderRows, taskRows, assignmentRows, downtimeRows, maintenanceRows, resultRows, eventRows, routeRows] = await Promise.all([
    selectAll(client, 'operational_plans'), selectAll(client, 'products'), selectAll(client, 'employees'), selectAll(client, 'equipment'),
    selectAll(client, 'shift_definitions'), selectAll(client, 'calendar_days'), selectAll(client, 'employee_schedules'),
    selectAll(client, 'production_orders'), selectAll(client, 'production_tasks'), selectAll(client, 'task_assignments'), selectAll(client, 'downtime_events'),
    selectAll(client, 'maintenance_orders'), selectAll(client, 'production_results'), selectAll(client, 'production_events'), selectAll(client, 'route_operations')
  ]);

  const latestPlan = [...plans].sort((a, b) => (num(b.version) - num(a.version)) || str(b.created_at).localeCompare(str(a.created_at)))[0];
  const tasks: ProductionTask[] = taskRows.map(row => ({ id: str(row.id), orderId: str(row.order_id), operationId: str(row.operation_id), operationSequence: num(row.operation_sequence), status: str(row.status) as ProductionTask['status'], plannedStart: str(row.planned_start), plannedEnd: str(row.planned_end), actualStart: row.actual_start ? str(row.actual_start) : undefined, actualEnd: row.actual_end ? str(row.actual_end) : undefined, plannedQuantity: num(row.planned_quantity), actualQuantity: num(row.actual_quantity), assignedEmployeeIds: [], assignedEquipmentIds: [], version: num(row.version, 1) }));

  const assignmentByTask = new Map<string, { employeeIds: string[]; equipmentIds: string[] }>();
  for (const row of assignmentRows) {
    const taskId = str(row.task_id); const current = assignmentByTask.get(taskId) ?? { employeeIds: [], equipmentIds: [] };
    const employeeId = str(row.employee_id); const equipmentId = str(row.equipment_id);
    if (employeeId && !current.employeeIds.includes(employeeId)) current.employeeIds.push(employeeId);
    if (equipmentId && !current.equipmentIds.includes(equipmentId)) current.equipmentIds.push(equipmentId);
    assignmentByTask.set(taskId, current);
  }
  for (const task of tasks) { const assignment = assignmentByTask.get(task.id); if (assignment) { task.assignedEmployeeIds = assignment.employeeIds; task.assignedEquipmentIds = assignment.equipmentIds; } }

  const routesByProduct = buildRoutes(routeRows);
  const fallbackRouteByOrder = fallbackRoutesByOrder(tasks);
  const orders: ProductionOrder[] = orderRows.map(row => ({
    id: str(row.id),
    externalId: row.external_id ? str(row.external_id) : undefined,
    number: str(row.number),
    productId: str(row.product_id),
    quantity: num(row.quantity),
    completedQuantity: num(row.completed_quantity),
    dueAt: str(row.due_at),
    priority: str(row.priority) as ProductionOrder['priority'],
    status: str(row.status) as ProductionOrder['status'],
    route: routesByProduct.get(str(row.product_id)) ?? fallbackRouteByOrder.get(str(row.id)) ?? []
  }));

  return {
    plan: latestPlan ? { id: str(latestPlan.id), version: num(latestPlan.version, 1), horizonStart: str(latestPlan.horizon_start, fallback.plan.horizonStart), horizonEnd: str(latestPlan.horizon_end, fallback.plan.horizonEnd), status: str(latestPlan.status) as MesState['plan']['status'], sourcePlanId: latestPlan.source_plan_id ? str(latestPlan.source_plan_id) : undefined, sourcePlanVersion: latestPlan.source_plan_version ? num(latestPlan.source_plan_version) : undefined } : fallback.plan,
    products: productsRows.map(row => ({ id: str(row.id), code: str(row.code), name: str(row.name), unit: str(row.unit) })),
    employees: employeeRows.map(row => ({ id: str(row.id), personnelNo: str(row.personnel_no), name: str(row.name), profession: str(row.profession), qualificationLevel: num(row.qualification_level), active: bool(row.active, true) })),
    equipment: equipmentRows.map(row => ({ id: str(row.id), code: str(row.code), name: str(row.name), workCenter: str(row.work_center), capabilities: stringArray(row.capabilities), active: bool(row.active, true) })),
    shifts: (shiftRows.length ? shiftRows : fallback.shifts.map(shift => ({ id: shift.id, name: shift.name, start_minute: shift.startMinute, duration_minutes: shift.durationMinutes, active: true }))).map(row => ({ id: str(row.id), name: str(row.name), startMinute: num(row.start_minute), durationMinutes: num(row.duration_minutes), active: bool(row.active, true) })),
    calendar: calendarRows.length ? calendarRows.map(row => ({ date: str(row.date), isWorking: bool(row.is_working), shiftIds: stringArray(row.shift_ids) })) : fallback.calendar,
    employeeSchedules: scheduleRows.length ? scheduleRows.map(row => ({ employeeId: str(row.employee_id), date: str(row.date), shiftIds: stringArray(row.shift_ids), status: str(row.status) as EmployeeSchedule['status'] })) : fallback.employeeSchedules,
    orders,
    tasks,
    downtimes: downtimeRows.map(row => ({ id: str(row.id), equipmentId: str(row.equipment_id), reasonCode: str(row.reason_code), startedAt: str(row.started_at), endedAt: row.ended_at ? str(row.ended_at) : undefined, comment: row.comment ? str(row.comment) : undefined })),
    maintenance: maintenanceRows.map(row => ({ id: str(row.id), equipmentId: str(row.equipment_id), type: str(row.type) as MaintenanceOrder['type'], plannedStart: str(row.planned_start), plannedEnd: str(row.planned_end), status: str(row.status) as MaintenanceOrder['status'], comment: row.comment ? str(row.comment) : undefined })),
    results: resultRows.map(row => ({ id: str(row.id), taskId: str(row.task_id), recordedAt: str(row.recorded_at), goodQuantity: num(row.good_quantity), scrapQuantity: num(row.scrap_quantity), employeeIds: stringArray(row.employee_ids), equipmentIds: stringArray(row.equipment_ids), comment: row.comment ? str(row.comment) : undefined })),
    events: eventRows.map(row => ({ id: str(row.id), taskId: row.task_id ? str(row.task_id) : undefined, type: str(row.type) as ProductionEvent['type'], occurredAt: str(row.occurred_at), actorId: str(row.actor_id), payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {} }))
  };
}

export function applyRemoteSnapshot(state: MesState, snapshot: RemoteSnapshot): void {
  state.plan = snapshot.plan;
  state.products = snapshot.products;
  state.employees = snapshot.employees;
  state.equipment = snapshot.equipment;
  state.shifts = snapshot.shifts;
  state.calendar = snapshot.calendar;
  state.employeeSchedules = snapshot.employeeSchedules;
  state.orders = snapshot.orders;
  state.tasks = snapshot.tasks;
  state.downtimes = snapshot.downtimes;
  state.maintenance = snapshot.maintenance;
  state.results = snapshot.results;
  state.events = snapshot.events;
}
