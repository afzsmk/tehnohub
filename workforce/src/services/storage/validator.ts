// src/services/storage/validator.ts
import { ScenarioData, AppState } from '../../types';

export function normalizeScenario(sc: ScenarioData): ScenarioData {
  if (!sc.normConfigs) sc.normConfigs = {};
  if (!sc.settings) sc.settings = {} as any;
  const s = sc.settings;

  s.brigadesCount = s.brigadesCount ?? 3;
  s.brigadeSize = s.brigadeSize ?? 6;
  s.maxOvertimePercent = s.maxOvertimePercent ?? 15;
  s.fNom = s.fNom ?? 168;
  s.fEff = s.fEff ?? 144;
  s.kVn = s.kVn ?? 1.0;
  s.auxOtkPercent = s.auxOtkPercent ?? 0;
  s.auxSetupPercent = s.auxSetupPercent ?? 0;
  s.auxFixedPosts = s.auxFixedPosts ?? 0;
  s.workDaysPerMonth = s.workDaysPerMonth ?? 21;
  s.shiftHoursStandard = s.shiftHoursStandard ?? 8;
  s.companyName = s.companyName ?? 'ООО "ЗСМК"';

  if (s.reserveOffPercent === undefined) {
    s.reserveOffPercent = s.fNom > 0 ? Math.round((1 - (s.fEff / s.fNom)) * 1000) / 10 : 14.3;
  }
  s.extendedShiftHours = s.extendedShiftHours ?? 12;
  s.fNomExtended = s.fNomExtended ?? Math.round((s.fNom * s.extendedShiftHours / s.shiftHoursStandard) * 10) / 10;
  s.fEffExtended = s.fEffExtended ?? Math.round((s.fNomExtended * (1 - s.reserveOffPercent / 100)) * 10) / 10;

  (sc.professions || []).forEach(pr => {
    if (!pr.pool) {
      pr.pool = (["p1787298939301", "p1787298947495", "p1787298952912", "p1787298961438", "p1787298966902"].includes(pr.id) ? "dedicated" : "universal");
    }
    if (pr.minCrew === undefined) pr.minCrew = (pr.pool === "dedicated" ? 1 : 0);
    if (pr.availabilityHours === undefined) pr.availabilityHours = 24;
  });

  return sc;
}

export function validateImportedState(obj: any): string[] {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") { errors.push("Файл не содержит объекта верхнего уровня."); return errors; }
  if (!obj.scenarios || typeof obj.scenarios !== "object" || Array.isArray(obj.scenarios)) {
    errors.push('Отсутствует или повреждён раздел "scenarios".'); return errors;
  }
  const scKeys = Object.keys(obj.scenarios);
  if (scKeys.length === 0) { errors.push("В файле нет ни одного сценария."); return errors; }
  if (!obj.currentScenario || !scKeys.includes(obj.currentScenario)) {
    errors.push('Поле "currentScenario" отсутствует или не соответствует ни одному сценарию.');
  }

  scKeys.forEach(key => {
    const sc = obj.scenarios[key];
    const tag = `Сценарий «${key}»`;
    if (!Array.isArray(sc.professions)) { errors.push(`${tag}: отсутствует список "professions".`); return; }
    if (!Array.isArray(sc.products)) { errors.push(`${tag}: отсутствует список "products".`); return; }
    if (!Array.isArray(sc.months) || sc.months.length === 0) { errors.push(`${tag}: отсутствует список "months".`); return; }
    if (!sc.plan || typeof sc.plan !== "object") { errors.push(`${tag}: отсутствует раздел "plan".`); return; }

    const profIds = new Set(sc.professions.map((p: any) => p.id));
    sc.products.forEach((p: any, i: number) => {
      if (!p.id || !p.name) { errors.push(`${tag}: изделие #${i + 1} без id/name.`); return; }
      const row = sc.plan[p.id];
      if (!Array.isArray(row) || row.length !== sc.months.length) {
        errors.push(`${tag}: план по «${p.name}» не соответствует числу месяцев (${sc.months.length}).`);
      }
      if (p.norms && typeof p.norms === "object") {
        Object.keys(p.norms).forEach(pid => {
          if (!profIds.has(pid)) errors.push(`${tag}: у «${p.name}» есть норма на несуществующий участок.`);
        });
      }
    });
  });
  return errors;
}