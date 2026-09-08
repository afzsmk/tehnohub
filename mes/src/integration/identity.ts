export const MES_ROLES = [
  'ADMIN',
  'PRODUCTION_MANAGER',
  'PLANNER',
  'DISPATCHER',
  'MASTER',
  'OPERATOR',
  'MAINTENANCE',
  'QUALITY',
  'ANALYST'
] as const;

export type MesRole = (typeof MES_ROLES)[number] | 'SYSTEM_COMPAT';

export interface MesExecutionIdentity {
  userId: string;
  employeeId: string;
  role: MesRole;
}

export interface ExecutionActorContext {
  readonly userId: string;
  readonly employeeId: string;
  readonly role: MesRole;
}

export function assertExecutionIdentity(identity: MesExecutionIdentity): ExecutionActorContext {
  if (!identity.userId.trim()) throw new Error('MES userId обязателен');
  if (identity.role !== 'SYSTEM_COMPAT' && !MES_ROLES.includes(identity.role)) throw new Error('Недопустимая MES роль');
  if (identity.role === 'OPERATOR' && !identity.employeeId.trim()) throw new Error('MES employeeId обязателен для оператора');
  return { userId: identity.userId.trim(), employeeId: identity.employeeId.trim(), role: identity.role };
}

export function assertEmployeeInAssignment(employeeId: string, assignedEmployeeIds: readonly string[]): void {
  if (!employeeId.trim()) throw new Error('MES employeeId обязателен');
  if (!assignedEmployeeIds.includes(employeeId)) throw new Error('Сотрудник не назначен на это задание');
}
