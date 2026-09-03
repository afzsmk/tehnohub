// tests/levelLoading.test.ts
import { describe, it, expect } from 'vitest';
import { levelLoadPlan } from '../src/core/levelLoading';
import { ScenarioData } from '../src/types';

describe('Алгоритм выравнивания производственного плана (levelLoading.ts)', () => {
  const mockScenario: ScenarioData = {
    months: ['01/26', '02/26'],
    professions: [
      { id: 'p1', name: 'Сборка', pool: 'universal', machines: 1, crew: 1 }
    ],
    products: [
      { id: 'pr1', name: 'Панель', unit: 'м²', scrap: 0, norms: { p1: 1.0 } }
    ],
    // В первом месяце колоссальный пик (1000 шт), во втором — 0
    plan: {
      pr1: [1000, 0]
    },
    settings: {
      fNom: 168,
      fEff: 144,
      reserveOffPercent: 14.3,
      kVn: 1.0,
      brigadesCount: 1,
      brigadeSize: 2, // 2 человека = максимум ~288 н-ч/мес
      maxOvertimePercent: 0,
      auxOtkPercent: 0,
      auxSetupPercent: 0,
      auxFixedPosts: 0,
      workDaysPerMonth: 21,
      shiftHoursStandard: 8,
      extendedShiftHours: 12,
      fNomExtended: 252,
      fEffExtended: 216
    }
  };

  it('Сглаживает пиковую нагрузку и переносит излишки на свободный месяц', () => {
    // Целевой штат: 2 человека
    const result = levelLoadPlan(mockScenario, 2);

    const month1 = result.updatedPlan['pr1'][0];
    const month2 = result.updatedPlan['pr1'][1];

    // Часть объема должна была уйти во второй месяц
    expect(month1).toBeLessThan(1000);
    expect(month2).toBeGreaterThan(0);

    // Главное: общий выпуск продукции ДО и ПОСЛЕ выравнивания обязан совпадать!
    const totalBefore = mockScenario.plan['pr1'][0] + mockScenario.plan['pr1'][1];
    const totalAfter = month1 + month2;
    expect(Math.round(totalAfter)).toBe(totalBefore);
  });
});
