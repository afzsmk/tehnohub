import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface MesSupabaseConfig {
  url: string;
  publishableKey: string;
}

export function readMesSupabaseConfig(env: ImportMetaEnv = import.meta.env): MesSupabaseConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim();
  const publishableKey = String(
    env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''
  ).trim();
  return url && publishableKey ? { url, publishableKey } : null;
}

export function createMesSupabaseClient(config: MesSupabaseConfig): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

let singleton: SupabaseClient | null = null;

export function getMesSupabaseClient(): SupabaseClient | null {
  if (singleton) return singleton;
  const config = readMesSupabaseConfig();
  if (!config) return null;
  singleton = createMesSupabaseClient(config);
  return singleton;
}
