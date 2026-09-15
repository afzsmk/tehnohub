import type { SupabaseClient } from '@supabase/supabase-js';
import { ExecutionActorContext, MesRole, assertExecutionIdentity } from './identity';

export interface MesAuthenticatedIdentity {
  userId: string;
  employeeId: string;
  role: MesRole;
}

interface EmployeeMappingRow {
  employee_id: string;
  active: boolean;
}

export async function resolveMesIdentity(client: SupabaseClient): Promise<MesAuthenticatedIdentity | null> {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const user = sessionData.session?.user;
  if (!user) return null;

  const roleValue = user.app_metadata?.mes_role;
  const role = typeof roleValue === 'string' ? roleValue as MesRole : undefined;
  if (!role) throw new Error('У пользователя не задана MES роль');

  const { data, error } = await client
    .from('mes_user_employee')
    .select('employee_id, active')
    .eq('user_id', user.id)
    .maybeSingle<EmployeeMappingRow>();
  if (error) throw error;

  const employeeId = data?.active ? data.employee_id : '';
  return assertExecutionIdentity({
    userId: user.id,
    employeeId,
    role
  });
}

export function identityForCompatibility(userId: string): ExecutionActorContext {
  return assertExecutionIdentity({
    userId,
    employeeId: '',
    role: 'SYSTEM_COMPAT'
  });
}
