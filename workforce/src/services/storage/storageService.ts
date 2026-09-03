// src/services/storage/storageService.ts
import { AppState, ScenarioData } from '../../types';
import { PRELOADED_STATE } from './defaultState';
import { normalizeScenario } from './validator';
import { supabase, isSupabaseConfigured } from './supabaseClient';

export interface IStorageService {
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<void>;
  saveScenario(name: string, data: ScenarioData): Promise<void>;
  deleteScenario(name: string): Promise<void>;
}

const STORAGE_KEY = 'prod_workforce_master_v18';

export class HybridStorageService implements IStorageService {
  async loadState(): Promise<AppState> {
    // 1. Попытка загрузить из облака Supabase
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('workforce_scenarios')
          .select('id, data');

        if (!error && data && data.length > 0) {
          const scenarios: Record<string, ScenarioData> = {};
          data.forEach((row: { id: string; data: ScenarioData }) => {
            scenarios[row.id] = normalizeScenario(row.data);
          });

          // Читаем последний активный сценарий из локального кэша
          const localRaw = localStorage.getItem(STORAGE_KEY);
          let currentScenario = data[0].id;
          if (localRaw) {
            try {
              const parsed = JSON.parse(localRaw);
              if (scenarios[parsed.currentScenario]) currentScenario = parsed.currentScenario;
            } catch { /* игнорируем */ }
          }

          const state: AppState = { currentScenario, scenarios };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          this.notifyStatus('cloud');
          return state;
        }

        // Если таблица в облаке пока пустая — инициализируем её эталонными сценариями
        if (!error && data && data.length === 0) {
          await this.seedCloudDefaults();
          return PRELOADED_STATE;
        }
      } catch (err) {
        console.warn('Облако недоступно, переключаемся на локальный кэш:', err);
      }
    }

    // 2. Офлайн-режим (чтение из LocalStorage)
    this.notifyStatus('local');
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = JSON.parse(JSON.stringify(PRELOADED_STATE));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
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
    // Всегда сохраняем в локальный кэш
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    // И синхронизируем активный сценарий с Supabase
    const active = state.scenarios[state.currentScenario];
    if (active) {
      await this.saveScenario(state.currentScenario, active);
    }
  }

  async saveScenario(name: string, data: ScenarioData): Promise<void> {
    if (isSupabaseConfigured() && supabase) {
      this.notifyStatus('saving');
      try {
        await supabase
          .from('workforce_scenarios')
          .upsert({
            id: name,
            data: data,
            updated_at: new Date().toISOString()
          });
        this.notifyStatus('cloud');
      } catch (err) {
        console.error('Ошибка сохранения в облако:', err);
        this.notifyStatus('local');
      }
    }
  }

  async deleteScenario(name: string): Promise<void> {
    if (isSupabaseConfigured() && supabase) {
      try {
        await supabase
          .from('workforce_scenarios')
          .delete()
          .eq('id', name);
      } catch (err) {
        console.error('Ошибка удаления из облака:', err);
      }
    }
  }

  private async seedCloudDefaults(): Promise<void> {
    if (!supabase) return;
    const entries = Object.keys(PRELOADED_STATE.scenarios).map(name => ({
      id: name,
      data: PRELOADED_STATE.scenarios[name],
      updated_at: new Date().toISOString()
    }));
    await supabase.from('workforce_scenarios').upsert(entries);
    this.notifyStatus('cloud');
  }

  private notifyStatus(status: 'cloud' | 'local' | 'saving'): void {
    const el = document.getElementById('cloudSyncStatus');
    if (!el) return;
    if (status === 'cloud') {
      el.innerHTML = `<span style="color:#10b981;">●</span> Облако ЗСМК подключено`;
      el.style.color = '#94a3b8';
    } else if (status === 'saving') {
      el.innerHTML = `<span style="color:#f59e0b;">●</span> Сохранение в облако...`;
      el.style.color = '#f59e0b';
    } else {
      el.innerHTML = `<span style="color:#94a3b8;">○</span> Локальный режим`;
      el.style.color = '#94a3b8';
    }
  }
}

export const storageService: IStorageService = new HybridStorageService();
