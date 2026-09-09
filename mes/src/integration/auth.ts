import type { SupabaseClient, User } from '@supabase/supabase-js';
import { resolveMesIdentity, MesAuthenticatedIdentity } from './identitySession';
import { SupabaseMesRuntimeSnapshotRpc } from './mesRuntimeSnapshotRpc';
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

async function cacheRemoteState(client: SupabaseClient, userId: string): Promise<boolean> {
  const storage = browserStorage();
  if (!storage) return false;
  const current = readLocalState();
  if (!current) return false;

  const hadRemoteUser = storage.getItem(REMOTE_USER_KEY) === userId;
  if (!storage.getItem(DEMO_BACKUP_KEY) && !hadRemoteUser) {
    storage.setItem(DEMO_BACKUP_KEY, JSON.stringify(current));
  }

  // Always refresh from the authoritative RPC for an authenticated session.
  // The persisted user marker only prevents unnecessary demo backups; it must
  // never suppress a refresh after a page reload or a concurrent server update.
  const snapshot = await new SupabaseMesRuntimeSnapshotRpc(client).load(current.plan.id);
  const merged: MesState = {
    ...current,
    ...(snapshot.plan ? { plan: snapshot.plan } : {}),
    products: snapshot.products ?? [],
    employees: snapshot.employees ?? [],
    equipment: snapshot.equipment ?? [],
    shifts: snapshot.shifts ?? [],
    calendar: snapshot.calendar ?? [],
    employeeSchedules: snapshot.employeeSchedules ?? [],
    equipmentBlocks: snapshot.equipmentBlocks ?? [],
    orders: snapshot.orders ?? [],
    tasks: snapshot.tasks ?? [],
    downtimes: snapshot.downtimes ?? [],
    maintenance: snapshot.maintenance ?? [],
    results: snapshot.results ?? [],
    qualityInspections: snapshot.qualityInspections ?? [],
    events: snapshot.events ?? []
  };

  const changed = JSON.stringify(current) !== JSON.stringify(merged);
  if (!changed) {
    storage.setItem(REMOTE_USER_KEY, userId);
    return false;
  }

  storage.setItem(MES_STATE_KEY, JSON.stringify(merged));
  storage.setItem(REMOTE_USER_KEY, userId);
  return true;
}

function restoreDemoState(): void {
  const storage = browserStorage();
  if (!storage) return;
  const backup = storage.getItem(DEMO_BACKUP_KEY);
  if (backup) storage.setItem(MES_STATE_KEY, backup);
  storage.removeItem(DEMO_BACKUP_KEY);
  storage.removeItem(REMOTE_USER_KEY);
}

async function ensureRemoteStateLoaded(client: SupabaseClient, userId: string): Promise<void> {
  const loaded = await cacheRemoteState(client, userId);
  if (loaded && typeof window !== 'undefined') window.location.reload();
}

export async function getMesAuthState(client: SupabaseClient): Promise<MesAuthState> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const user = data.session?.user ?? null;
  if (!user) return { user: null, identity: null };
  const identity = await resolveMesIdentity(client);
  await ensureRemoteStateLoaded(client, user.id);
  return { user, identity };
}

export async function signInMes(client: SupabaseClient, email: string, password: string): Promise<MesAuthState> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const state = await getMesAuthState(client);
  if (typeof window !== 'undefined') window.location.reload();
  return state;
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
      const identity = await resolveMesIdentity(client);
      await ensureRemoteStateLoaded(client, session.user.id);
      await callback({ user: session.user, identity });
    })().catch(() => undefined);
  });
  return () => data.subscription.unsubscribe();
}
