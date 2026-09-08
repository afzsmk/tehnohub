import type { SupabaseClient, User } from '@supabase/supabase-js';
import { resolveMesIdentity, MesAuthenticatedIdentity } from './identitySession';

export interface MesAuthState {
  user: User | null;
  identity: MesAuthenticatedIdentity | null;
}

export async function getMesAuthState(client: SupabaseClient): Promise<MesAuthState> {
  const { data, error } = await client.auth.getUser();
  if (error && error.message) throw error;
  const user = data.user;
  if (!user) return { user: null, identity: null };
  return { user, identity: await resolveMesIdentity(client) };
}

export async function signInMes(client: SupabaseClient, email: string, password: string): Promise<MesAuthState> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return getMesAuthState(client);
}

export async function signOutMes(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export function subscribeMesAuth(client: SupabaseClient, callback: (state: MesAuthState) => void | Promise<void>): () => void {
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    void (async () => {
      if (!session?.user) {
        await callback({ user: null, identity: null });
        return;
      }
      await callback({ user: session.user, identity: await resolveMesIdentity(client) });
    })();
  });
  return () => data.subscription.unsubscribe();
}
