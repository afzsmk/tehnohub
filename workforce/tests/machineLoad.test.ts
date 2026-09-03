// tests/machineLoad.test.ts
import { describe, it, expect } from 'vitest';
import { classifyMachineLoad } from '../src/core/machineLoad';

describe('Классификация загрузки оборудования (machineLoad.ts)', () => {
  const caps = {
    workDaysPerMonth: 21,
    shiftHoursStandard: 8,
    availabilityHours: 24
  };

  it('Возвращает статус "Простой", если часы равны нулю', () => {
    const res = classifyMachineLoad(0, caps);
    expect(res.statusZone).toBe('none');
    expect(res.tierLabel).toBe('Простой');
    expect(res.pct24).toBe(0);
  });

  it('Определяет зеленую зону (норма 8ч/5-2)', () => {
    // 168 часов на станок в месяц / 21 день = 8.0 ч/сут
    const res = classifyMachineLoad(168, caps);
    expect(res.statusZone).toBe('green');
    expect(res.isExtendedShift).toBe(false);
    expect(res.recommendedShift).toBe(8);
  });

  it('Определяет желтую зону и рекомендует смену с шагом 0.5ч', () => {
    // 210 часов / 21 день = 10.0 ч/сут -> смена 10ч
    const res = classifyMachineLoad(210, caps);
    expect(res.statusZone).toBe('yellow');
    expect(res.isExtendedShift).toBe(true);
    expect(res.recommendedShift).toBe(10);

    // 195 часов / 21 день = 9.28 ч/сут -> смена округляется вверх до 9.5ч
    const res2 = classifyMachineLoad(195, caps);
    expect(res2.recommendedShift).toBe(9.5);
  });

  it('Определяет красный статус при перегрузе выше потолка 12ч', () => {
    // 300 часов / 21 день = 14.28 ч/сут -> выше предела 12ч
    const res = classifyMachineLoad(300, caps);
    expect(res.statusZone).toBe('red');
    expect(res.recommendedShift).toBe(12);
  });
});
