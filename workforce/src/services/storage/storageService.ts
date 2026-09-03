// src/services/storage/storageService.ts
import { AppState } from '../../types';
import { PRELOADED_STATE } from './defaultState';
import { normalizeScenario } from './validator';

export interface IStorageService {
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<void>;
}

const STORAGE_KEY = 'prod_workforce_master_v18';

export class LocalStorageService implements IStorageService {
  async loadState(): Promise<AppState> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = JSON.parse(JSON.stringify(PRELOADED_STATE));
      await this.saveState(initial);
      return initial;
    }
    try {
      const parsed: AppState = JSON.parse(raw);
      Object.keys(parsed.scenarios).forEach(key => {
        parsed.scenarios[key] = normalizeScenario(parsed.scenarios[key]);
      });
      return parsed;
    } catch {
      return JSON.parse(JSON.stringify(PRELOADED_STATE));
    }
  }

  async saveState(state: AppState): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

/**
 * Заготовка под облачный Supabase:
 * Для включения нужно установить `@supabase/supabase-js` и передать URL + ANON KEY
 */
export class SupabaseStorageService implements IStorageService {
  constructor(private supabaseClient: any) {}

  async loadState(): Promise<AppState> {
    const { data, error } = await this.supabaseClient
      .from('workforce_state')
      .select('state')
      .single();

    if (error || !data) return new LocalStorageService().loadState();
    return data.state;
  }

  async saveState(state: AppState): Promise<void> {
    await this.supabaseClient
      .from('workforce_state')
      .upsert({ id: 'default', state, updated_at: new Date() });
  }
}

// Экземпляр по умолчанию (сейчас LocalStorage, прозрачно заменяемый в будущем)
export const storageService: IStorageService = new LocalStorageService();