import { MesState } from '../types';

const STORAGE_KEY = 'zsmk_mes_state_v1';

export function loadState(seed: MesState): MesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(seed);
    return JSON.parse(raw) as MesState;
  } catch {
    return structuredClone(seed);
  }
}

export function saveState(state: MesState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
