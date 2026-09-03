// src/services/storage/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

// ВСТАВЬТЕ СЮДА ВАШИ ДАННЫЕ ИЗ SUPABASE:
const SUPABASE_URL = 'https://cihzyokqrjpmzoiezmwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHp5b2txcmpwbXpvaWV6bXdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MzUzNzQsImV4cCI6MjEwNDAxMTM3NH0.-JcZ9ZN3REh83mZOYA9Rajy8J9uxxx8ZqfzA0VkTzAI';

export const isSupabaseConfigured = (): boolean => {
  return !SUPABASE_URL.includes('cihzyokqrjpmzoiezmwc') && !SUPABASE_ANON_KEY.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHp5b2txcmpwbXpvaWV6bXdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MzUzNzQsImV4cCI6MjEwNDAxMTM3NH0.-JcZ9ZN3REh83mZOYA9Rajy8J9uxxx8ZqfzA0VkTzAI');
};

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
