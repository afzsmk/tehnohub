// src/core/engine.ts
import { ScenarioData, CalculationResult, UniversalScheduleResult, MachineZoneResult } from '../types';
import { parseNum } from './funds';
import { classifyMachineLoad } from './machineLoad';

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
    if (prof.pool === 'universal') {
      staffByProfSp[prof.id] = new Array(numMonths).fill(0);
      staffByProfYav[prof.id] = new Array(numMonths).fill(0);
      return;
    }
    const machines = Math.max(1, prof.machines || 1);
    const crew = Math.max(1, prof.crew || 1);
    const minCrew = parseNum(prof.minCrew) || 0;
    const fixedComposition = Math.max(crew * machines, minCrew);
    staffByProfSp[prof.id] = hoursByProf[prof.id].map(h => h > 0 ? fixedComposition : 0);
    staffByProfYav[prof.id] = staffByProfSp[prof.id].slice();
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

  const mainStaffSpTotal = new Array(numMonths).fill(0);
  for (let m = 0; m < numMonths; m++) {
    let dedicatedSum = 0;
    dedicatedProfs.forEach(p => {
      dedicatedSum += staffByProfSp[p.id][m];
    });
    mainStaffSpTotal[m] = universalStaffSpTotal[m] + dedicatedSum;
  }

  const auxPercent = parseNum(data.settings.auxOtkPercent) + parseNum(data.settings.auxSetupPercent);
  const auxFixed = parseNum(data.settings.auxFixedPosts);
  const auxStaffSpTotal = mainStaffSpTotal.map(mStaff => (mStaff * (auxPercent / 100)) + auxFixed);

  const grandTotalStaff = mainStaffSpTotal.map((_, idx) => {
    const uniCeil = Math.ceil(universalStaffSpTotal[idx]);
    let dedCeilSum = 0;
    dedicatedProfs.forEach(p => {
      dedCeilSum += Math.ceil(staffByProfSp[p.id][idx]);
    });
    return uniCeil + dedCeilSum + Math.ceil(auxStaffSpTotal[idx]);
  });

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
    mainStaffSpTotal, auxStaffSpTotal, grandTotalStaff
  };
}