export interface MesExecutionIdentity {
  userId: string;
  employeeId: string;
  role: string;
}

export interface ExecutionActorContext {
  readonly userId: string;
  readonly employeeId: string;
  readonly role: string;
}

export function assertExecutionIdentity(identity: MesExecutionIdentity): ExecutionActorContext {
  if (!identity.userId.trim()) throw new Error('MES userId обязателен');
  if (!identity.employeeId.trim()) throw new Error('MES employeeId обязателен');
  if (!identity.role.trim()) throw new Error('MES role обязателен');
  return { userId: identity.userId.trim(), employeeId: identity.employeeId.trim(), role: identity.role.trim() };
}

export function assertEmployeeInAssignment(
  employeeId: string,
  assignedEmployeeIds: readonly string[]
): void {
  if (!assignedEmployeeIds.includes(employeeId)) {
    throw new Error('Сотрудник не назначен на это задание');
  }
}
