// src/core/levelLoading.ts
import { ScenarioData } from '../types';
import { parseNum } from './funds';

export interface LevelLoadingResult {
  updatedPlan: Record<string, number[]>;
  totalShiftedHours: number;
  maxMonthlyHours: number;
}

export function levelLoadPlan(data: ScenarioData, targetHeadcount: number): LevelLoadingResult {
  const plan: Record<string, number[]> = JSON.parse(JSON.stringify(data.plan));
  const fEff = data.settings.fEff || 144;
  const kVn = data.settings.kVn || 1.05;
  const auxPercent = ((data.settings.auxOtkPercent || 0) + (data.settings.auxSetupPercent || 0)) / 100;
  const auxFixed = data.settings.auxFixedPosts || 2;

  const targetMainWorkers = Math.max(1, targetHeadcount - auxFixed) / (1 + auxPercent);
  const maxMonthlyHours = targetMainWorkers * fEff * kVn;
  const numMonths = data.months.length;
  let totalShiftedHours = 0;

  function getMonthLabor(mIdx: number): number {
    let hrs = 0;
    data.products.forEach(p => {
      const qty = plan[p.id]?.[mIdx] || 0;
      const scrap = 1 + (p.scrap / 100);
      let pNorm = 0;
      data.professions.forEach(prof => { pNorm += parseNum(p.norms[prof.id]); });
      hrs += qty * pNorm * scrap;
    });
    return hrs;
  }

  // Проход вперед
  for (let m = 0; m < numMonths - 1; m++) {
    let currentLabor = getMonthLabor(m);
    if (currentLabor > maxMonthlyHours) {
      let excess = currentLabor - maxMonthlyHours;
      for (let targetM = m + 1; targetM < numMonths && excess > 0.1; targetM++) {
        const targetLabor = getMonthLabor(targetM);
        const available = Math.max(0, maxMonthlyHours - targetLabor);
        if (available > 0.1) {
          const shiftHrs = Math.min(excess, available);
          const ratio = shiftHrs / currentLabor;
          data.products.forEach(p => {
            const q = plan[p.id]?.[m] || 0;
            if (q > 0) {
              const qShift = q * ratio;
              plan[p.id][m] = Math.round((q - qShift) * 10) / 10;
              plan[p.id][targetM] = Math.round(((plan[p.id][targetM] || 0) + qShift) * 10) / 10;
            }
          });
          excess -= shiftHrs;
          totalShiftedHours += shiftHrs;
          currentLabor = getMonthLabor(m);
        }
      }
    }
  }

  // Проход назад
  for (let m = numMonths - 1; m >= 1; m--) {
    let currentLabor = getMonthLabor(m);
    if (currentLabor > maxMonthlyHours) {
      let excess = currentLabor - maxMonthlyHours;
      for (let targetM = m - 1; targetM >= 0 && excess > 0.1; targetM--) {
        const targetLabor = getMonthLabor(targetM);
        const available = Math.max(0, maxMonthlyHours - targetLabor);
        if (available > 0.1) {
          const shiftHrs = Math.min(excess, available);
          const ratio = shiftHrs / currentLabor;
          data.products.forEach(p => {
            const q = plan[p.id]?.[m] || 0;
            if (q > 0) {
              const qShift = q * ratio;
              plan[p.id][m] = Math.round((q - qShift) * 10) / 10;
              plan[p.id][targetM] = Math.round(((plan[p.id][targetM] || 0) + qShift) * 10) / 10;
            }
          });
          excess -= shiftHrs;
          totalShiftedHours += shiftHrs;
          currentLabor = getMonthLabor(m);
        }
      }
    }
  }

  return { updatedPlan: plan, totalShiftedHours, maxMonthlyHours };
}