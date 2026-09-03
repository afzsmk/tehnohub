// tests/funds.test.ts
import { describe, it, expect } from 'vitest';
import { parseNum, ceilToHalfClamped, calcFNom, calcFEff, calcExtendedFNom } from '../src/core/funds';

describe('Модуль фондов и утилит (funds.ts)', () => {
  it('parseNum корректно обрабатывает запятые, пробелы и пустые строки', () => {
    expect(parseNum("1 250,50")).toBe(1250.5);
    expect(parseNum("0,646")).toBe(0.646);
    expect(parseNum(42)).toBe(42);
    expect(parseNum("")).toBe(0);
    expect(parseNum(null)).toBe(0);
    expect(parseNum(undefined)).toBe(0);
  });

  it('ceilToHalfClamped округляет вверх до шага 0.5ч и соблюдает границы', () => {
    // 8.1ч должно округлиться до 8.5ч
    expect(ceilToHalfClamped(8.1, 8, 12)).toBe(8.5);
    // 8.6ч должно округлиться до 9.0ч
    expect(ceilToHalfClamped(8.6, 8, 12)).toBe(9.0);
    // Ниже минимума -> возвращает минимум
    expect(ceilToHalfClamped(6.0, 8, 12)).toBe(8);
    // Выше максимума -> возвращает максимум
    expect(ceilToHalfClamped(14.5, 8, 12)).toBe(12);
  });

  it('Корректно вычисляет номинальный и эффективный фонды', () => {
    // 21 день * 8 часов = 168 ч
    expect(calcFNom(21, 8)).toBe(168);
    // 168 ч с резервом отсутствий 14.3% = 144 ч
    expect(calcFEff(168, 14.3)).toBe(144);
    // Усиленный режим: 168 * 12 / 8 = 252 ч
    expect(calcExtendedFNom(168, 12, 8)).toBe(252);
  });
});
