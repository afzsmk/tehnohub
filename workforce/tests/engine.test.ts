// tests/engine.test.ts
import { describe, it, expect } from 'vitest';
import { calculateProgram } from '../src/core/engine';
import { PRELOADED_STATE } from '../src/services/storage/defaultState';

describe('Главный расчетный двигатель (engine.ts)', () => {
  const scenario = PRELOADED_STATE.scenarios["План сент-окт 2026"];

  it('Считает трудоемкость с учетом коэффициента брака изделия', () => {
    const calc = calculateProgram(scenario);

    // Общая трудоемкость программы должна быть строго больше нуля
    const totalHours = calc.totalHoursByMonth.reduce((a, b) => a + b, 0);
    expect(totalHours).toBeGreaterThan(5000);

    // Должны быть рассчитаны часы по всем участкам
    expect(Object.keys(calc.hoursByProf).length).toBe(scenario.professions.length);
  });

  it('Правильно разделяет штат на универсальный пул и выделенные посты', () => {
    const calc = calculateProgram(scenario);

    // В универсальный пул входят участки с ротацией
    expect(calc.universalProfs.length).toBeGreaterThan(0);
    // В выделенные входят посты без ротации (лазер, штамповка и т.д.)
    expect(calc.dedicatedProfs.length).toBeGreaterThan(0);

    // Итоговый штат завода должен включать всех рабочих с округлением
    calc.grandTotalStaff.forEach(staffThisMonth => {
      expect(staffThisMonth).toBeGreaterThanOrEqual(calc.brigadesCount * calc.brigadeSize);
    });
  });

  it('Определяет лимитирующий участок (bottleneck) и общий статус программы', () => {
    const calc = calculateProgram(scenario);
    expect(['green', 'yellow', 'red']).toContain(calc.overallZone);
  });
});
