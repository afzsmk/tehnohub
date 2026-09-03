// src/core/norming.ts
import { StatNormConfig, ChronoNormConfig } from '../types';

export function calculateStatNorm(cfg: StatNormConfig): number {
  const q = cfg.output || 1;
  const w = cfg.workers || 1;
  const h = cfg.shiftHours || 8;
  const b = cfg.breaks || 0;
  const kEff = cfg.kEff || 1;

  const netHours = Math.max(0, h - (b / 60));
  const totalLabor = w * netHours * kEff;
  return totalLabor / q;
}

export function calculateChronoNorm(cfg: ChronoNormConfig): number {
  const tOp = (cfg.tOsn || 0) + (cfg.tVsp || 0);
  const batch = cfg.batchSize || 50;
  const pieceCycle = (tOp * (1 + ((cfg.kObs || 0) + (cfg.kOtl || 0)) / 100)) + ((cfg.tPz || 0) / batch);
  return (pieceCycle * (cfg.crew || 1)) / 60;
}