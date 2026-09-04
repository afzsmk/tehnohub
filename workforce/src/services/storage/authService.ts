// src/services/storage/authService.ts
import { supabase } from './supabaseClient';
import { User } from '@supabase/supabase-js';

export const authService = {
  async getUser(): Promise<User | null> {
    if (!supabase) return null;
    try {
      const { data } = await supabase.auth.getUser();
      return data.user;
    } catch {
      return null;
    }
  },

  async signIn(email: string, password: string): Promise<{ user: User | null; error: string | null }> {
    if (!supabase) return { user: null, error: 'Облако Supabase не настроено.' };
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { user: null, error: error.message };
      return { user: data.user, error: null };
    } catch (err: any) {
      return { user: null, error: err.message || 'Ошибка входа' };
    }
  },

  async signOut(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  onAuthStateChange(callback: (user: User | null) => void): void {
    if (!supabase) return;
    supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user || null);
    });
  }
};
