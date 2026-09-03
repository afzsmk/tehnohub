// src/types.ts

export type PoolType = 'universal' | 'dedicated';
export type StatusZone = 'green' | 'yellow' | 'red' | 'none';
export type NormMethod = 'stat' | 'chrono';

export interface Profession {
  id: string;
  name: string;
  pool: PoolType;
  machines: number;
  crew: number;
  minCrew?: number;
  availabilityHours?: number;
  type?: 'machine' | 'manual';
}

export interface Product {
  id: string;
  name: string;
  unit: string;
  scrap: number;
  norms: Record<string, number>; // profId -> norm (hours/unit)
}

export interface Settings {
  companyName?: string;
  fNom: number;
  fEff: number;
  reserveOffPercent: number;
  kVn: number;
  brigadesCount: number;
  brigadeSize: number;
  maxOvertimePercent: number;
  auxOtkPercent: number;
  auxSetupPercent: number;
  auxFixedPosts: number;
  workDaysPerMonth: number;
  shiftHoursStandard: number;
  extendedShiftHours: number;
  fNomExtended: number;
  fEffExtended: number;
}

export interface StatNormConfig {
  output: number;
  workers: number;
  shiftHours: number;
  breaks: number;
  kEff: number;
}

export interface ChronoNormConfig {
  tOsn: number;
  tVsp: number;
  crew: number;
  kObs: number;
  kOtl: number;
  tPz: number;
  batchSize: number;
}

export interface NormConfigEntry {
  prodId: string;
  profId: string;
  prodName: string;
  profName: string;
  method: NormMethod;
  stat?: StatNormConfig;
  chrono?: ChronoNormConfig;
  norm: number;
  updatedAt: string;
}

export interface ScenarioData {
  professions: Profession[];
  products: Product[];
  months: string[];
  plan: Record<string, number[]>; // prodId -> array of quantities per month
  settings: Settings;
  normConfigs?: Record<string, NormConfigEntry>; // key: `${prodId}___${profId}`
  _planSnapshot?: Record<string, number[]>;
}

export interface AppState {
  currentScenario: string;
  scenarios: Record<string, ScenarioData>;
}

export interface MachineZoneResult {
  badgeClass: string;
  statusZone: StatusZone;
  pct24: number;
  hoursPerDay: number;
  tierLabel: string;
  plainLabel: string;
  isExtendedShift: boolean;
  recommendedShift: number;
  label: string;
}

export interface UniversalScheduleResult {
  mode: string;
  badgeClass: string;
  overtimeHours: number;
  statusZone: StatusZone;
  isExtendedShift: boolean;
  recommendedShift: number;
  trueNeededShift: number;
  canApplyShift: number | null;
  additionalHeadcount: number;
  note: string;
}

export interface CalculationResult {
  numMonths: number;
  fNom: number;
  fEff: number;
  kVn: number;
  extendedShiftHours: number;
  fNomExtended: number;
  fEffExtended: number;
  brigadesCount: number;
  brigadeSize: number;
  maxOvertimePct: number;
  totalUniversalHeadcount: number;
  oneBrigadeCapacity: number;
  totalPoolNominalCapacity: number;
  totalPoolMaxWithOvertime: number;
  poolCapacityNormal: number;
  poolCapacityNormalOT: number;
  poolCapacityCeiling: number;
  hardShiftCeiling: number;
  workDaysPerMonth: number;
  shiftHoursStandard: number;
  reserveOffPercent: number;
  caps: { workDaysPerMonth: number; shiftHoursStandard: number };
  profMachineZones: Record<string, MachineZoneResult[]>;
  productTotals: Record<string, number>;
  hoursByProf: Record<string, number[]>;
  hoursByProduct: Record<string, number[]>;
  totalHoursByMonth: number[];
  staffByProfSp: Record<string, number[]>;
  staffByProfYav: Record<string, number[]>;
  universalProfs: Profession[];
  dedicatedProfs: Profession[];
  universalHoursTotal: number[];
  universalStaffSpTotal: number[];
  universalSchedules: UniversalScheduleResult[];
  overallZone: StatusZone;
  mainStaffSpTotal: number[];
  auxStaffSpTotal: number[];
  grandTotalStaff: number[];
}