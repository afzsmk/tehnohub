import type { SupabaseClient, User } from '@supabase/supabase-js';
import { resolveMesIdentity, MesAuthenticatedIdentity } from './identitySession';
import { loadMesStateFromSupabase } from './remoteState';
import type { MesState } from '../types';

const MES_STATE_KEY = 'zsmk_mes_state_v1';
const DEMO_BACKUP_KEY = 'zsmk_mes_demo_backup_v1';
const REMOTE_USER_KEY = 'zsmk_mes_remote_user_v1';

export interface MesAuthState {
  user: User | null;
  identity: MesAuthenticatedIdentity | null;
}

function readLocalState(): MesState | null {
  try {
    const raw = localStorage.getItem(MES_STATE_KEY);
    return raw ? JSON.parse(raw) as MesState : null;
  } catch {
    return null;
  }
}

async function cacheRemoteState(client: SupabaseClient, userId: string): Promise<boolean> {
  if (typeof window === 'undefined' || localStorage.getItem(REMOTE_USER_KEY) === userId) return false;
  const current = readLocalState();
  if (!current) return false;
  if (!localStorage.getItem(DEMO_BACKUP_KEY)) localStorage.setItem(DEMO_BACKUP_KEY, JSON.stringify(current));

  const snapshot = await loadMesStateFromSupabase(client, current);
  const merged: MesState = {
    ...current,
    plan: snapshot.plan,
    products: snapshot.products,
    employees: snapshot.employees,
    equipment: snapshot.equipment,
    shifts: snapshot.shifts,
    calendar: snapshot.calendar,
    employeeSchedules: snapshot.employeeSchedules,
    equipmentBlocks: snapshot.equipmentBlocks,
    orders: snapshot.orders,
    tasks: snapshot.tasks,
    downtimes: snapshot.downtimes,
    maintenance: snapshot.maintenance,
    results: snapshot.results,
    qualityInspections: snapshot.qualityInspections,
    events: snapshot.events
  };

  localStorage.setItem(MES_STATE_KEY, JSON.stringify(merged));
  localStorage.setItem(REMOTE_USER_KEY, userId);
  return true;
}

function restoreDemoState(): void {
  if (typeof window === 'undefined') return;
  const backup = localStorage.getItem(DEMO_BACKUP_KEY);
  if (backup) localStorage.setItem(MES_STATE_KEY, backup);
  localStorage.removeItem(DEMO_BACKUP_KEY);
  localStorage.removeItem(REMOTE_USER_KEY);
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
