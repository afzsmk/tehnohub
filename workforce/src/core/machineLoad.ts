// src/core/machineLoad.ts
import { MachineZoneResult } from '../types';
import { ceilToHalfClamped } from './funds';

export interface MachineCaps {
  workDaysPerMonth: number;
  shiftHoursStandard: number;
  availabilityHours: number;
}

export function classifyMachineLoad(hoursPerMachine: number, caps: MachineCaps): MachineZoneResult {
  const { workDaysPerMonth, shiftHoursStandard, availabilityHours } = caps;
  const HARD_SHIFT_CEILING = 12;
  const hoursPerDay = hoursPerMachine / workDaysPerMonth;
  const pct24 = Math.round((hoursPerDay / 24) * 100);
  const ceilingShift = Math.max(shiftHoursStandard, Math.min(HARD_SHIFT_CEILING, availabilityHours));

  if (hoursPerMachine <= 0) {
    return {
      badgeClass: '',
      statusZone: 'none',
      pct24: 0,
      hoursPerDay: 0,
      tierLabel: 'Простой',
      plainLabel: 'Простой',
      isExtendedShift: false,
      recommendedShift: shiftHoursStandard,
      label: `<span style="color:var(--text-muted); font-size:12px;">Простой</span>`
    };
  }

  let statusZone: MachineZoneResult['statusZone'] = 'green';
  let tierLabel = '';
  let isExtendedShift = false;
  let recommendedShift = shiftHoursStandard;

  if (hoursPerDay <= shiftHoursStandard) {
    statusZone = 'green';
    tierLabel = `${shiftHoursStandard}ч (норма)`;
    isExtendedShift = false;
  } else if (hoursPerDay <= ceilingShift) {
    recommendedShift = ceilToHalfClamped(hoursPerDay, shiftHoursStandard, ceilingShift);
    statusZone = 'yellow';
    tierLabel = `Рекомендована смена: ${recommendedShift}ч`;
    isExtendedShift = true;
  } else {
    recommendedShift = ceilingShift;
    statusZone = 'red';
    tierLabel = `Перегруз (нужно ${hoursPerDay.toFixed(1)}ч, доступно ≤${ceilingShift}ч)`;
    isExtendedShift = true;
  }

  const zoneColor = { green: 'var(--success)', yellow: 'var(--warning)', red: 'var(--danger)', none: 'var(--text-muted)' }[statusZone];
  const zoneFill = { green: '#86efac', yellow: '#fde68a', red: '#fca5a5', none: '#e2e8f0' }[statusZone];
  const barWidth = Math.min(100, pct24);
  const plainLabel = `${pct24}% от 24ч (${hoursPerDay.toFixed(1)}ч/сут) · ${tierLabel}`;

  const label = `
    <div style="display:flex; flex-direction:column; gap:3px; min-width:112px;" title="${plainLabel}">
      <div style="display:flex; align-items:center; gap:6px;">
        <div style="flex:1; height:7px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
          <div style="width:${barWidth}%; height:100%; background:${zoneFill};"></div>
        </div>
        <span style="font-size:12px; font-weight:700; color:${zoneColor}; min-width:32px; text-align:right;">${pct24}%</span>
      </div>
      <div style="font-size:10.5px; color:var(--text-muted); white-space:nowrap;">${hoursPerDay.toFixed(1)}ч/сут · ${tierLabel}</div>
    </div>
  `;

  return { badgeClass: '', statusZone, pct24, hoursPerDay, tierLabel, plainLabel, isExtendedShift, recommendedShift, label };
}