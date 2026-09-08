import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface MesSupabaseConfig {
  url: string;
  anonKey: string;
}

export function readMesSupabaseConfig(env: ImportMetaEnv = import.meta.env): MesSupabaseConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function createMesSupabaseClient(config: MesSupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
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
