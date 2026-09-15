import type { SupabaseClient, User } from '@supabase/supabase-js';
import { resolveMesIdentity, MesAuthenticatedIdentity } from './identitySession';
import type { MesState } from '../types';

const MES_STATE_KEY = 'zsmk_mes_state_v1';
const DEMO_BACKUP_KEY = 'zsmk_mes_demo_backup_v1';
const REMOTE_USER_KEY = 'zsmk_mes_remote_user_v1';

export interface MesAuthState {
  user: User | null;
  identity: MesAuthenticatedIdentity | null;
}

function browserStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readLocalState(): MesState | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(MES_STATE_KEY);
    return raw ? JSON.parse(raw) as MesState : null;
  } catch {
    return null;
  }
}

function restoreDemoState(): void {
  const storage = browserStorage();
  if (!storage) return;
  const backup = storage.getItem(DEMO_BACKUP_KEY);
  if (backup) storage.setItem(MES_STATE_KEY, backup);
  storage.removeItem(DEMO_BACKUP_KEY);
  storage.removeItem(REMOTE_USER_KEY);
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
  restoreDemoState();
  if (typeof window !== 'undefined') window.location.reload();
}

export function subscribeMesAuth(client: SupabaseClient, callback: (state: MesAuthState) => void | Promise<void>): () => void {
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    void (async () => {
      if (!session?.user) {
        restoreDemoState();
        await callback({ user: null, identity: null });
        return;
      }
      const identity = await resolveIdentityOrNull(client);
      await callback({ user: session.user, identity });
    })().catch(() => undefined);
  });
  return () => data.subscription.unsubscribe();
}