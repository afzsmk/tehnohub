import type { SupabaseClient, User } from '@supabase/supabase-js';
import { resolveMesIdentity, MesAuthenticatedIdentity } from './identitySession';

export interface MesAuthState {
  user: User | null;
  identity: MesAuthenticatedIdentity | null;
}

async function resolveIdentityOrNull(client: SupabaseClient): Promise<MesAuthenticatedIdentity | null> {
  try {
    return await resolveMesIdentity(client);
  } catch (error) {
    if (error instanceof Error && error.message === 'У пользователя не задана MES роль') return null;
    throw error;
  }
}

export async function getMesAuthState(client: SupabaseClient): Promise<MesAuthState> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const user = data.session?.user ?? null;
  if (!user) return { user: null, identity: null };
  const identity = await resolveIdentityOrNull(client);
  return { user, identity };
}

export async function signInMes(client: SupabaseClient, email: string, password: string): Promise<MesAuthState> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return getMesAuthState(client);
}

export async function signOutMes(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
  if (typeof window !== 'undefined') window.location.reload();
}

export function subscribeMesAuth(client: SupabaseClient, callback: (state: MesAuthState) => void | Promise<void>): () => void {
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    void (async () => {
      if (!session?.user) {
        await callback({ user: null, identity: null });
        return;
      }
      const identity = await resolveIdentityOrNull(client);
      await callback({ user: session.user, identity });
    })().catch(() => undefined);
  });
  return () => data.subscription.unsubscribe();
}