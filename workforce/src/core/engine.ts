// src/core/engine.ts
import { ScenarioData, CalculationResult, UniversalScheduleResult, MachineZoneResult, WorkforceMode, WorkforceView, DedicatedStaffDetail } from '../types';
import { parseNum, ceilToHalfClamped } from './funds';
import { classifyMachineLoad } from './machineLoad';

function effectiveFundForShift(data: ScenarioData, shiftHours: number): number {
  const standard = parseNum(data.settings.shiftHoursStandard) || 8;
  const fEff = parseNum(data.settings.fEff) || 144;
  const fEffExtended = parseNum(data.settings.fEffExtended) || (fEff * ((parseNum(data.settings.extendedShiftHours) || 12) / standard));
  const extended = parseNum(data.settings.extendedShiftHours) || 12;
  const kVn = parseNum(data.settings.kVn) || 1;

  let fund = fEff;
  if (shiftHours <= standard) {
    fund = fEff * (shiftHours / standard);
  } else if (extended > standard) {
    const ratio = Math.min(1, Math.max(0, (shiftHours - standard) / (extended - standard)));
    fund = fEff + (fEffExtended - fEff) * ratio;
  } else {
    fund = fEffExtended;
  }

  return fund * kVn;
}

function calculateDedicatedStaffDetail(
  data: ScenarioData,
  prof: any,
  laborHours: number,
  zone: MachineZoneResult | undefined,
  mode: WorkforceMode
): DedicatedStaffDetail {
  const machines = Math.max(1, parseNum(prof.machines) || 1);
  const crew = Math.max(1, parseNum(prof.crew) || 1);
  const minCrew = Math.max(0, parseNum(prof.minCrew));
  const minimumStaff = Math.max(machines * crew, minCrew);
  const packSize = machines * crew;
  const workDays = Math.max(1, parseNum(data.settings.workDaysPerMonth) || 21);
  const standard = parseNum(data.settings.shiftHoursStandard) || 8;
  const hardCeiling = 12;
  const availability = Math.max(1, Math.min(24, parseNum(prof.availabilityHours) || 24));
  const maxShift = Math.min(hardCeiling, availability);
  const hoursPerMachineDay = laborHours > 0 ? laborHours / (crew * machines * workDays) : 0;

  let shiftHours = Math.min(standard, availability);
  if (mode === '12h') {
    shiftHours = Math.min(hardCeiling, availability);
  } else if (mode === 'auto') {
    if (zone?.statusZone === 'yellow') {
      shiftHours = Math.min(maxShift, Math.max(standard, zone.recommendedShift));
    } else if (zone?.statusZone === 'red') {
      shiftHours = maxShift;
    }
  }
  shiftHours = Math.max(1, shiftHours);

  const fundPerWorker = effectiveFundForShift(data, shiftHours);
  const rawStaff = laborHours > 0 ? laborHours / fundPerWorker : 0;
  const requiredTeams = laborHours > 0 ? Math.max(1, Math.ceil(rawStaff / packSize)) : 0;
  const requiredStaff = laborHours > 0 ? Math.max(minimumStaff, requiredTeams * packSize) : 0;

  const equipmentOverload = laborHours > 0 && hoursPerMachineDay > availability + 1e-9;
  const statusZone = equipmentOverload
    ? 'red'
    : (shiftHours > standard || requiredTeams > 1 ? 'yellow' : 'green');

  const shiftText = Number.isInteger(shiftHours) ? String(shiftHours) : shiftHours.toFixed(1);
  let note = laborHours <= 0
    ? 'Пост не задействован'
    : `мин. ${minimumStaff} чел. → требуется ${requiredStaff} чел. (${requiredTeams} ${requiredTeams === 1 ? 'звено' : 'звена'} × ${crew * machines} чел.), ${shiftText}ч`;

  if (equipmentOverload) {
    note += `; оборудование: ${hoursPerMachineDay.toFixed(1)} ч/сут при доступности ${availability} ч/сут — физически не обеспечивается`;
  } else if (requiredTeams > 1) {
    note += '; нагрузка закрывается несколькими сменными звеньями';
  }

  return {
    minimumStaff,
    requiredStaff,
    requiredTeams,
    shiftHours,
    fundPerWorker,
    hoursPerMachineDay,
    statusZone,
    equipmentOverload,
    note
  };
}

function buildFixedUniversalSchedule(
  data: ScenarioData,
  universalHours: number,
  totalHeadcount: number,
  mode: '8h' | '12h'
): UniversalScheduleResult {
  const standard = parseNum(data.settings.shiftHoursStandard) || 8;
  const shiftHours = mode === '8h' ? standard : (parseNum(data.settings.extendedShiftHours) || 12);
  const fundPerWorker = effectiveFundForShift(data, shiftHours);
  const capacity = totalHeadcount * fundPerWorker;
  const deficit = Math.max(0, universalHours - capacity);
  const additionalHeadcount = deficit > 0 ? Math.ceil(deficit / fundPerWorker) : 0;
  const label = mode === '8h' ? `${standard}ч · обычный режим` : `${shiftHours}ч · усиленный режим`;

  return {
    mode: deficit > 0 ? `${label} · дефицит` : label,
    badgeClass: deficit > 0 ? 'badge-shift-overload' : (mode === '8h' ? 'badge-shift-1' : 'badge-shift-12'),
    overtimeHours: 0,
    statusZone: deficit > 0 ? 'red' : 'green',
    isExtendedShift: mode === '12h',
    recommendedShift: shiftHours,
    trueNeededShift: shiftHours,
    canApplyShift: null,
    additionalHeadcount,
    note: deficit > 0
      ? `При ${totalHeadcount} универсалах не хватает ${Math.round(deficit)} н-ч; требуется дополнительно ${additionalHeadcount} чел.`
      : `Трудоёмкость укладывается в фонд ${Math.round(capacity)} н-ч`
  };
}

export function calculateProgram(data: ScenarioData): CalculationResult {
  const numMonths = data.months.length;
  const fNom = parseNum(data.settings.fNom) || 168;
  const fEff = parseNum(data.settings.fEff) || 144;
  const kVn = parseNum(data.settings.kVn) || 1.0;

  const brigadesCount = Math.max(1, parseInt(String(data.settings.brigadesCount)) || 3);
  const brigadeSize = Math.max(1, parseInt(String(data.settings.brigadeSize)) || 6);
  const maxOvertimePct = Math.max(0, Math.min(30, parseNum(data.settings.maxOvertimePercent)));
  const totalUniversalHeadcount = brigadesCount * brigadeSize;

  const workDaysPerMonth = Math.max(1, parseInt(String(data.settings.workDaysPerMonth)) || 21);
  const shiftHoursStandard = parseNum(data.settings.shiftHoursStandard) || 8;

  const extendedShiftHours = parseNum(data.settings.extendedShiftHours) || 12;
  const fNomExtended = parseNum(data.settings.fNomExtended) || (fNom * extendedShiftHours / shiftHoursStandard);
  const fEffExtended = parseNum(data.settings.fEffExtended) || (fEff * extendedShiftHours / shiftHoursStandard);
  const reserveOffPercent = parseNum(data.settings.reserveOffPercent);

  const productTotals: Record<string, number> = {};
  data.products.forEach(p => {
    const row = data.plan[p.id] || [];
    productTotals[p.id] = row.reduce((sum, val) => sum + parseNum(val), 0);
  });

  const hoursByProf: Record<string, number[]> = {};
  data.professions.forEach(prof => { hoursByProf[prof.id] = new Array(numMonths).fill(0); });
  const hoursByProduct: Record<string, number[]> = {};
  data.products.forEach(p => { hoursByProduct[p.id] = new Array(numMonths).fill(0); });

  const totalHoursByMonth = new Array(numMonths).fill(0);

  for (let m = 0; m < numMonths; m++) {
    data.products.forEach(p => {
      const qty = (data.plan[p.id] && data.plan[p.id][m]) ? parseNum(data.plan[p.id][m]) : 0;
      const scrapMultiplier = 1 + (parseNum(p.scrap) / 100);

      let pLaborThisMonth = 0;
      data.professions.forEach(prof => {
        const unitNorm = parseNum(p.norms[prof.id]);
        const labor = qty * unitNorm * scrapMultiplier;
        hoursByProf[prof.id][m] += labor;
        pLaborThisMonth += labor;
      });

      hoursByProduct[p.id][m] = pLaborThisMonth;
      totalHoursByMonth[m] += pLaborThisMonth;
    });
  }

  const caps = { workDaysPerMonth, shiftHoursStandard };
  const profMachineZones: Record<string, MachineZoneResult[]> = {};
  data.professions.forEach(prof => {
    const machines = Math.max(1, prof.machines || 1);
    const crew = Math.max(1, prof.crew || 1);
    const availabilityHours = Math.max(shiftHoursStandard, Math.min(24, parseNum(prof.availabilityHours) || 24));
    profMachineZones[prof.id] = [];
    for (let m = 0; m < numMonths; m++) {
      const laborHours = hoursByProf[prof.id][m];
      const hoursPerMachine = (laborHours / crew) / machines;
      profMachineZones[prof.id].push(classifyMachineLoad(hoursPerMachine, { ...caps, availabilityHours }));
    }
  });

  const staffByProfSp: Record<string, number[]> = {};
  const staffByProfYav: Record<string, number[]> = {};
  data.professions.forEach(prof => {
    staffByProfSp[prof.id] = new Array(numMonths).fill(0);
    staffByProfYav[prof.id] = new Array(numMonths).fill(0);
  });

  const universalProfs = data.professions.filter(p => p.pool === 'universal');
  const dedicatedProfs = data.professions.filter(p => p.pool !== 'universal');

  const universalHoursTotal = new Array(numMonths).fill(0);
  const universalStaffSpTotal = new Array(numMonths).fill(0);
  const universalSchedules: UniversalScheduleResult[] = [];

  const HARD_SHIFT_CEILING = 12;
  const poolCapacityNormal = totalUniversalHeadcount * fEff * kVn;
  const poolCapacityNormalOT = poolCapacityNormal * (1 + maxOvertimePct / 100);
  const fEffAtCeiling = workDaysPerMonth * HARD_SHIFT_CEILING * (1 - reserveOffPercent / 100);
  const poolCapacityCeiling = totalUniversalHeadcount * fEffAtCeiling * kVn;

  for (let m = 0; m < numMonths; m++) {
    universalProfs.forEach(p => {
      universalHoursTotal[m] += hoursByProf[p.id][m];
    });

    const uHours = universalHoursTotal[m];
    const sched: UniversalScheduleResult = {
      mode: `${shiftHoursStandard}ч/5-2 (норма)`,
      badgeClass: 'badge-shift-1',
      overtimeHours: 0,
      statusZone: 'green',
      isExtendedShift: false,
      recommendedShift: shiftHoursStandard,
      trueNeededShift: shiftHoursStandard,
      canApplyShift: null,
      additionalHeadcount: 0,
      note: ''
    };

    if (uHours <= poolCapacityNormal) {
      sched.mode = `${shiftHoursStandard}ч/5-2 (норма)`;
      sched.badgeClass = 'badge-shift-1';
      sched.statusZone = 'green';
      sched.note = `В пределах номинального фонда всех ${totalUniversalHeadcount} универсалов на графике 5/2 по ${shiftHoursStandard}ч`;
    } else if (uHours <= poolCapacityNormalOT) {
      sched.mode = `${shiftHoursStandard}ч/5-2 + сверхурочные`;
      sched.badgeClass = 'badge-shift-overload';
      sched.statusZone = 'yellow';
      sched.overtimeHours = Math.round(uHours - poolCapacityNormal);
      const otPerWorker = (sched.overtimeHours / totalUniversalHeadcount).toFixed(1);
      const otPctOfLimit = maxOvertimePct > 0 ? Math.round((sched.overtimeHours / (poolCapacityNormal * maxOvertimePct / 100)) * 100) : 0;
      sched.note = `Закрывается разовыми сверхурочными: +${sched.overtimeHours} н-ч (+${otPerWorker} ч/чел, ${otPctOfLimit}% от лимита сверхурочных)`;
    } else if (uHours <= poolCapacityCeiling) {
      const neededShiftFull = Math.max(shiftHoursStandard, uHours / (totalUniversalHeadcount * kVn * workDaysPerMonth * (1 - reserveOffPercent / 100)));
      const neededShiftRounded = Math.min(HARD_SHIFT_CEILING, Math.ceil(neededShiftFull * 2) / 2);
      sched.trueNeededShift = neededShiftRounded;
      sched.mode = `${neededShiftRounded}ч/5-2 (усиленный режим)`;
      sched.badgeClass = 'badge-shift-12';
      sched.statusZone = 'yellow';
      sched.isExtendedShift = true;
      sched.recommendedShift = neededShiftRounded;
      sched.note = `Требуется перевести всех ${totalUniversalHeadcount} универсалов на смену ${neededShiftRounded}ч`;
      if (neededShiftRounded !== extendedShiftHours) {
        sched.canApplyShift = neededShiftRounded;
      }
    } else {
      const deficitHours = uHours - poolCapacityCeiling;
      const additionalHeadcount = Math.ceil(deficitHours / (fEffAtCeiling * kVn));
      const additionalBrigades = Math.ceil(additionalHeadcount / brigadeSize);
      sched.mode = 'Критический дефицит мощности';
      sched.badgeClass = 'badge-shift-overload';
      sched.statusZone = 'red';
      sched.isExtendedShift = true;
      sched.recommendedShift = HARD_SHIFT_CEILING;
      sched.trueNeededShift = HARD_SHIFT_CEILING;
      sched.additionalHeadcount = additionalHeadcount;
      sched.note = `Даже смены ${HARD_SHIFT_CEILING}ч не хватает: дефицит +${Math.round(deficitHours)} н-ч. Нужно ещё как минимум ${additionalHeadcount} чел. (≈${additionalBrigades} бриг.)`;
    }

    const fEffToUse = sched.isExtendedShift ? fEffExtended : fEff;
    universalStaffSpTotal[m] = universalHoursTotal[m] / (fEffToUse * kVn);

    universalProfs.forEach(p => {
      staffByProfSp[p.id][m] = hoursByProf[p.id][m] / (fEffToUse * kVn);
      staffByProfYav[p.id][m] = staffByProfSp[p.id][m];
    });

    universalSchedules.push(sched);
  }

  // Выделенные посты: crew×machines остаётся минимумом, а трудоёмкость
  // определяет реальное число сменных звеньев. Расчёт делается отдельно для Auto/8ч/12ч.
  const dedicatedDetailsByMode: Record<WorkforceMode, Record<string, DedicatedStaffDetail[]>> = {
    auto: {},
    '8h': {},
    '12h': {}
  };

  dedicatedProfs.forEach(prof => {
    dedicatedDetailsByMode.auto[prof.id] = [];
    dedicatedDetailsByMode['8h'][prof.id] = [];
    dedicatedDetailsByMode['12h'][prof.id] = [];

    for (let m = 0; m < numMonths; m++) {
      const laborHours = hoursByProf[prof.id][m];
      const zone = profMachineZones[prof.id][m];

      (['auto', '8h', '12h'] as WorkforceMode[]).forEach(mode => {
        dedicatedDetailsByMode[mode][prof.id][m] =
          calculateDedicatedStaffDetail(data, prof, laborHours, zone, mode);
      });

      staffByProfSp[prof.id][m] = dedicatedDetailsByMode.auto[prof.id][m].requiredStaff;
      staffByProfYav[prof.id][m] = staffByProfSp[prof.id][m];
    }
  });

  function buildWorkforceView(mode: WorkforceMode): WorkforceView {
    const viewStaffByProf: Record<string, number[]> = {};
    const viewStaffByProfYav: Record<string, number[]> = {};
    data.professions.forEach(prof => {
      viewStaffByProf[prof.id] = new Array(numMonths).fill(0);
      viewStaffByProfYav[prof.id] = new Array(numMonths).fill(0);
    });

    const viewUniversalSchedules: UniversalScheduleResult[] = [];
    const viewUniversalStaff = new Array(numMonths).fill(0);

    for (let m = 0; m < numMonths; m++) {
      if (mode === 'auto') {
        viewUniversalStaff[m] = universalStaffSpTotal[m];
        viewUniversalSchedules[m] = universalSchedules[m];
        universalProfs.forEach(p => {
          viewStaffByProf[p.id][m] = staffByProfSp[p.id][m];
          viewStaffByProfYav[p.id][m] = staffByProfYav[p.id][m];
        });
      } else {
        const fixedShift = mode === '8h' ? shiftHoursStandard : extendedShiftHours;
        const fixedFund = effectiveFundForShift(data, fixedShift);
        viewUniversalStaff[m] = universalHoursTotal[m] / fixedFund;
        viewUniversalSchedules[m] = buildFixedUniversalSchedule(data, universalHoursTotal[m], totalUniversalHeadcount, mode);
        universalProfs.forEach(p => {
          viewStaffByProf[p.id][m] = hoursByProf[p.id][m] / fixedFund;
          viewStaffByProfYav[p.id][m] = viewStaffByProf[p.id][m];
        });
      }

      dedicatedProfs.forEach(p => {
        viewStaffByProf[p.id][m] = dedicatedDetailsByMode[mode][p.id][m].requiredStaff;
        viewStaffByProfYav[p.id][m] = viewStaffByProf[p.id][m];
      });
    }

    const viewMainStaff = new Array(numMonths).fill(0);
    const viewAuxStaff = new Array(numMonths).fill(0);
    const viewGrandTotal = new Array(numMonths).fill(0);
    const auxPercent = parseNum(data.settings.auxOtkPercent) + parseNum(data.settings.auxSetupPercent);
    const auxFixed = parseNum(data.settings.auxFixedPosts);

    for (let m = 0; m < numMonths; m++) {
      let dedicatedSum = 0;
      dedicatedProfs.forEach(p => { dedicatedSum += viewStaffByProf[p.id][m]; });
      viewMainStaff[m] = viewUniversalStaff[m] + dedicatedSum;
      viewAuxStaff[m] = (viewMainStaff[m] * (auxPercent / 100)) + auxFixed;

      const uniCeil = Math.ceil(viewUniversalStaff[m]);
      let dedCeilSum = 0;
      dedicatedProfs.forEach(p => { dedCeilSum += Math.ceil(viewStaffByProf[p.id][m]); });
      viewGrandTotal[m] = uniCeil + dedCeilSum + Math.ceil(viewAuxStaff[m]);
    }

    return {
      mode,
      modeLabel: mode === 'auto' ? 'Авто' : mode === '8h' ? '8 ч' : '12 ч',
      universalStaffSpTotal: viewUniversalStaff,
      staffByProfSp: viewStaffByProf,
      staffByProfYav: viewStaffByProfYav,
      auxStaffSpTotal: viewAuxStaff,
      mainStaffSpTotal: viewMainStaff,
      grandTotalStaff: viewGrandTotal,
      universalSchedules: viewUniversalSchedules,
      dedicatedDetails: dedicatedDetailsByMode[mode]
    };
  }

  const workforceViews: Record<WorkforceMode, WorkforceView> = {
    auto: buildWorkforceView('auto'),
    '8h': buildWorkforceView('8h'),
    '12h': buildWorkforceView('12h')
  };

  const mainStaffSpTotal = workforceViews.auto.mainStaffSpTotal;
  const auxStaffSpTotal = workforceViews.auto.auxStaffSpTotal;
  const grandTotalStaff = workforceViews.auto.grandTotalStaff;

  let overallZone: CalculationResult['overallZone'] = 'green';
  for (let m = 0; m < numMonths; m++) {
    if (universalSchedules[m].statusZone === 'red') overallZone = 'red';
    else if (universalSchedules[m].statusZone === 'yellow' && overallZone !== 'red') overallZone = 'yellow';
  }
  data.professions.forEach(prof => {
    profMachineZones[prof.id].forEach(z => {
      if (z.statusZone === 'red') overallZone = 'red';
      else if (z.statusZone === 'yellow' && overallZone !== 'red') overallZone = 'yellow';
    });
  });

  return {
    numMonths, fNom, fEff, kVn,
    extendedShiftHours, fNomExtended, fEffExtended,
    brigadesCount, brigadeSize, maxOvertimePct, totalUniversalHeadcount,
    oneBrigadeCapacity: poolCapacityNormal, totalPoolNominalCapacity: poolCapacityNormal, totalPoolMaxWithOvertime: poolCapacityCeiling,
    poolCapacityNormal, poolCapacityNormalOT, poolCapacityCeiling, hardShiftCeiling: HARD_SHIFT_CEILING,
    workDaysPerMonth, shiftHoursStandard, reserveOffPercent, caps, profMachineZones,
    productTotals, hoursByProf, hoursByProduct,
    totalHoursByMonth, staffByProfSp, staffByProfYav,
    universalProfs, dedicatedProfs, universalHoursTotal, universalStaffSpTotal,
    universalSchedules, overallZone,
    mainStaffSpTotal, auxStaffSpTotal, grandTotalStaff, workforceViews
  };
}