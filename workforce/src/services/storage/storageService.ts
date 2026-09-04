// src/services/storage/storageService.ts
import { AppState, ScenarioData } from '../../types';
import { PRELOADED_STATE } from './defaultState';
import { normalizeScenario } from './validator';
import { supabase, isSupabaseConfigured } from './supabaseClient';

export type StorageMode = 'local' | 'cloud';

export interface IStorageService {
  getMode(): StorageMode;
  setMode(mode: StorageMode): void;
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<void>;
  saveScenario(name: string, data: ScenarioData): Promise<void>;
  deleteScenario(name: string): Promise<void>;
  publishToCloud(scenarioName: string, data: ScenarioData): Promise<void>;
}

const STORAGE_KEY_LOCAL = 'prod_workforce_local_v2';
const STORAGE_KEY_CLOUD_CACHE = 'prod_workforce_cloud_cache_v2';

export class DualStorageService implements IStorageService {
  private mode: StorageMode = 'local';

  getMode(): StorageMode {
    return this.mode;
  }

  setMode(mode: StorageMode): void {
    this.mode = mode;
  }

  async loadState(): Promise<AppState> {
    if (this.mode === 'cloud' && isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('workforce_scenarios')
          .select('id, data')
          .order('updated_at', { ascending: false });

        if (!error && data && data.length > 0) {
          const scenarios: Record<string, ScenarioData> = {};
          data.forEach((row: { id: string; data: ScenarioData }) => {
            scenarios[row.id] = normalizeScenario(row.data);
          });

          let currentScenario = data[0].id;
          const cached = localStorage.getItem(STORAGE_KEY_CLOUD_CACHE);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              if (scenarios[parsed.currentScenario]) currentScenario = parsed.currentScenario;
            } catch { /* игнор */ }
          }

          const state: AppState = { currentScenario, scenarios };
          localStorage.setItem(STORAGE_KEY_CLOUD_CACHE, JSON.stringify(state));
          return state;
        }

        // Если в облаке пока пусто — загружаем эталоны
        if (!error && data && data.length === 0) {
          await this.seedCloudDefaults();
          return PRELOADED_STATE;
        }
      } catch (err) {
        console.warn('Сбой связи с облаком, открываем резервный кэш:', err);
      }

      // Резервный кэш облака
      const cachedRaw = localStorage.getItem(STORAGE_KEY_CLOUD_CACHE);
      if (cachedRaw) {
        try {
          return JSON.parse(cachedRaw);
        } catch { /* игнор */ }
      }
    }

    // Режим «Память браузера» (Local Sandbox)
    const raw = localStorage.getItem(STORAGE_KEY_LOCAL);
    if (!raw) {
      const initial = JSON.parse(JSON.stringify(PRELOADED_STATE));
      localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(initial));
      return initial;
    }

    try {
      const parsed: AppState = JSON.parse(raw);
      Object.keys(parsed.scenarios).forEach(k => {
        parsed.scenarios[k] = normalizeScenario(parsed.scenarios[k]);
      });
      return parsed;
    } catch {
      return JSON.parse(JSON.stringify(PRELOADED_STATE));
    }
  }

  async saveState(state: AppState): Promise<void> {
    if (this.mode === 'cloud') {
      localStorage.setItem(STORAGE_KEY_CLOUD_CACHE, JSON.stringify(state));
      const active = state.scenarios[state.currentScenario];
      if (active) {
        await this.saveScenario(state.currentScenario, active);
      }
    } else {
      localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(state));
    }
  }

  async saveScenario(name: string, data: ScenarioData): Promise<void> {
    if (this.mode === 'cloud' && isSupabaseConfigured() && supabase) {
      const { error } = await supabase
        .from('workforce_scenarios')
        .upsert({
          id: name,
          data: data,
          updated_at: new Date().toISOString()
        });
      if (error) {
        console.error('Ошибка записи в Supabase:', error);
        throw new Error(error.message);
      }
    }
  }

  async deleteScenario(name: string): Promise<void> {
    if (this.mode === 'cloud' && isSupabaseConfigured() && supabase) {
      const { error } = await supabase
        .from('workforce_scenarios')
        .delete()
        .eq('id', name);
      if (error) throw new Error(error.message);
    }
  }

  // Опубликовать локальный черновик в официальное облако завода
  async publishToCloud(scenarioName: string, data: ScenarioData): Promise<void> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase не подключен.');
    }
    const { error } = await supabase
      .from('workforce_scenarios')
      .upsert({
        id: scenarioName,
        data: data,
        updated_at: new Date().toISOString()
      });
    if (error) throw new Error(error.message);
  }

  private async seedCloudDefaults(): Promise<void> {
    if (!supabase) return;
    const entries = Object.keys(PRELOADED_STATE.scenarios).map(name => ({
      id: name,
      data: PRELOADED_STATE.scenarios[name],
      updated_at: new Date().toISOString()
    }));
    await supabase.from('workforce_scenarios').upsert(entries);
  }
}

export const storageService = new DualStorageService();
