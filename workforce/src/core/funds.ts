// src/core/funds.ts
export function parseNum(val: unknown): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val).replace(/\s+/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function ceilToHalfClamped(value: number, min: number, max: number): number {
  const rounded = Math.ceil(value * 2) / 2;
  return Math.max(min, Math.min(max, rounded));
}

export function calcFNom(workDays: number, shiftHours: number): number {
  return Math.round(workDays * shiftHours * 10) / 10;
}

export function calcFEff(fNom: number, reserveOffPercent: number): number {
  return Math.round(fNom * (1 - reserveOffPercent / 100) * 10) / 10;
}

export function calcExtendedFNom(fNom: number, extendedShift: number, shiftStd: number): number {
  return Math.round((fNom * extendedShift / shiftStd) * 10) / 10;
}