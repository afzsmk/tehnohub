import { ScenarioData, CalculationResult, AnalysisDisplayMode, WorkforceView } from '../../types';

function getView(calc: CalculationResult, mode: AnalysisDisplayMode): WorkforceView {
  return mode === '8h' ? calc.workforceViews['8h'] : mode === '12h' ? calc.workforceViews['12h'] : calc.workforceViews.auto;
}

function modeChip(mode: AnalysisDisplayMode, calc: CalculationResult, idx: number): string {
  if (mode === 'compare') return '<span class="mode-chip mode-compare">8 ч / 12 ч</span>';
  if (mode === '8h') return '<span class="mode-chip mode-normal">8 ч · фикс.</span>';
  if (mode === '12h') return '<span class="mode-chip mode-extended">12 ч · фикс.</span>';
  const sched = calc.workforceViews.auto.universalSchedules[idx];
  const cls = sched.statusZone === 'red' ? 'mode-alert' : sched.isExtendedShift ? 'mode-extended' : 'mode-ok';
  const label = sched.statusZone === 'red'
    ? 'ДЕФИЦИТ'
    : sched.overtimeHours > 0
    ? '8 ч + СУР'
    : sched.isExtendedShift
    ? `${sched.recommendedShift}ч усил.`
    : '8 ч норма';
  return `<span class="mode-chip ${cls}">${label}</span>`;
}

function dedicatedCell(calc: CalculationResult, data: ScenarioData, profId: string, mIdx: number, mode: AnalysisDisplayMode): string {
  const actualMode = mode === 'compare' ? 'auto' : mode;
  const view = getView(calc, actualMode);
  const value = view.staffByProfSp[profId][mIdx];
  const detail = view.dedicatedDetails[profId][mIdx];
  if (!detail || value <= 0) return '<span style="color:var(--text-muted);">—</span>';
  const shiftText = Number.isInteger(detail.shiftHours) ? String(detail.shiftHours) : detail.shiftHours.toFixed(1);
  const staffText = `${Math.round(value)} чел.`;
  const minText = `мин. ${detail.minimumStaff}`;
  const teamText = detail.requiredTeams === 1 ? '1 звено' : `${detail.requiredTeams} звена`;
  const chipClass = detail.equipmentOverload ? 'mode-alert' : detail.shiftHours > (calc.shiftHoursStandard || 8) || detail.requiredTeams > 1 ? 'mode-extended' : 'mode-ok';
  const chip = `<span class="mode-chip ${chipClass}">${shiftText}ч · ${teamText}</span>`;
  const warning = detail.equipmentOverload ? '<div class="cell-staff-detail" style="color:var(--danger); font-weight:700;">⚠ физическая перегрузка оборудования</div>' : '';
  return `<div><strong>${staffText}</strong></div><div class="cell-staff-detail">${minText} → ${teamText} · ${chip}</div>${warning}`;
}

export function renderShiftScheduleTable(calc: CalculationResult, data: ScenarioData, mode: AnalysisDisplayMode = 'auto'): void {
  const thead = document.getElementById('shiftScheduleTableHeader');
  const tbody = document.getElementById('shiftScheduleTableBody');
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <th class="col-sticky-name" style="min-width: 240px;">Участок / Оборудование</th>
    <th style="width: 65px; text-align: center;">Станков</th>
    <th style="width: 75px; text-align: center;">Звено</th>
    <th style="width: 90px; text-align: center;">Доступность</th>
    ${data.months.map((m) => `<th style="text-align:center; min-width:110px;">${m}<div style="margin-top:2px;"><span class="mode-chip mode-normal">физ. загрузка</span></div></th>`).join('')}
  `;

  tbody.innerHTML = data.professions.map(prof => {
    const machines = Math.max(1, prof.machines || 1);
    const crew = Math.max(1, prof.crew || 1);
    const availabilityHours = Math.max(1, Math.min(24, prof.availabilityHours || 24));
    const poolType = prof.pool || 'universal';

    return `
      <tr>
        <td class="col-sticky-name">
          <strong>${prof.name}</strong>
          <span class="${poolType === 'universal' ? 'badge-pool-universal' : 'badge-pool-dedicated'}" style="font-size:10px; margin-left:6px;">${poolType === 'universal' ? 'Универсал' : 'Выделенный'}</span>
        </td>
        <td style="text-align:center; font-weight:600;">${machines}</td>
        <td style="text-align:center; color:var(--text-secondary);">${crew} чел</td>
        <td style="text-align:center; color:var(--text-secondary);">${availabilityHours === 24 ? 'не огранич.' : availabilityHours + 'ч/сут'}</td>
        ${data.months.map((_,mIdx) => {
          const zone = calc.profMachineZones[prof.id][mIdx];
          return `<td style="text-align:center;">${zone.label}</td>`;
        }).join('')}
      </tr>`;
  }).join('');
}

export function renderResultsTable(calc: CalculationResult, data: ScenarioData, mode: AnalysisDisplayMode = 'auto'): void {
  const thead = document.getElementById('resultsTableHeader');
  const tbody = document.getElementById('resultsTableBody');
  if (!thead || !tbody) return;

  if (mode === 'compare') {
    const v8 = calc.workforceViews['8h'];
    const v12 = calc.workforceViews['12h'];
    const cell = (a:number,b:number) => `<div class="compare-value"><strong>${Math.round(a)} / ${Math.round(b)}</strong><span>8 ч / 12 ч</span></div>`;
    thead.innerHTML = `<th class="col-sticky-name" style="min-width:260px;">Показатель / Пул квалификации</th>${data.months.map((m) => `<th style="text-align:right; min-width:95px;">${m}<div style="margin-top:2px;"><span class="mode-chip mode-compare">8 ч / 12 ч</span></div></th>`).join('')}<th style="text-align:right; min-width:110px;">Пик</th>`;

    tbody.innerHTML = `
      <tr style="background:#f8fafc; font-weight:700;"><td class="col-sticky-name" colspan="${data.months.length + 2}">1. Прямая трудоёмкость по операциям (н-ч) — одинакова в обоих режимах</td></tr>
      ${data.professions.map(prof => {
        const row = calc.hoursByProf[prof.id];
        const total = row.reduce((a,b)=>a+b,0);
        return `<tr><td class="col-sticky-name" style="padding-left:18px;">${prof.name}<span class="${prof.pool === 'universal' ? 'badge-pool-universal' : 'badge-pool-dedicated'}" style="font-size:10px; margin-left:6px;">${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'}</span></td>${row.map(h=>`<td style="text-align:right;">${Math.round(h).toLocaleString()}</td>`).join('')}<td style="text-align:right;font-weight:600;">${Math.round(total).toLocaleString()}</td></tr>`;
      }).join('')}
      <tr style="font-weight:700;background:#f1f5f9;"><td class="col-sticky-name">ИТОГО прямая трудоёмкость</td>${calc.totalHoursByMonth.map(h=>`<td style="text-align:right;">${Math.round(h).toLocaleString()}</td>`).join('')}<td style="text-align:right;">—</td></tr>

      <tr style="background:#e0f2fe;font-weight:700;color:#0369a1;"><td class="col-sticky-name" colspan="${data.months.length + 2}">2. Универсальный пул — сравнение фиксированных фондов</td></tr>
      <tr style="font-weight:700;background:#f0f9ff;"><td class="col-sticky-name" style="padding-left:18px;color:#0369a1;">ШТАТ УНИВЕРСАЛОВ (чел.)</td>${data.months.map((_,i)=>`<td style="text-align:right;color:#0369a1;">${cell(v8.universalStaffSpTotal[i],v12.universalStaffSpTotal[i])}</td>`).join('')}<td style="text-align:right;">${Math.max(...v8.grandTotalStaff)} / ${Math.max(...v12.grandTotalStaff)}</td></tr>
      <tr style="font-weight:600;background:#f0f9ff;"><td class="col-sticky-name" style="padding-left:18px;color:#0369a1;">РЕЖИМ ПУЛА</td>${data.months.map((_,i)=>`<td style="text-align:right;font-size:11px;"><span class="mode-chip mode-normal">${v8.universalSchedules[i].mode}</span><br><span class="mode-chip mode-extended">${v12.universalSchedules[i].mode}</span></td>`).join('')}<td style="text-align:right;">—</td></tr>
      ${calc.universalProfs.map(prof=>`<tr style="color:var(--text-secondary);"><td class="col-sticky-name" style="padding-left:32px;font-size:12px;">↳ ${prof.name}</td>${data.months.map((_,i)=>`<td style="text-align:right;font-size:12px;">${v8.staffByProfSp[prof.id][i].toFixed(1)} / ${v12.staffByProfSp[prof.id][i].toFixed(1)}</td>`).join('')}<td style="text-align:right;">—</td></tr>`).join('')}

      <tr style="background:#fef3c7;font-weight:700;color:#92400e;"><td class="col-sticky-name" colspan="${data.months.length + 2}">3. Выделенные посты — минимум сохранён, потребность рассчитана по трудоёмкости</td></tr>
      ${calc.dedicatedProfs.map(prof => `
        <tr><td class="col-sticky-name" style="padding-left:18px;">${prof.name}</td>
          ${data.months.map((_,i)=>`<td style="text-align:right;">${Math.round(v8.staffByProfSp[prof.id][i])} / ${Math.round(v12.staffByProfSp[prof.id][i])}<div class="cell-staff-detail">8 ч / 12 ч</div>${v8.dedicatedDetails[prof.id][i].equipmentOverload || v12.dedicatedDetails[prof.id][i].equipmentOverload ? '<div class="cell-staff-detail" style="color:var(--danger);font-weight:700;">⚠ физ. перегруз</div>' : ''}</td>`).join('')}
          <td style="text-align:right;font-weight:600;">${Math.max(...v8.staffByProfSp[prof.id])} / ${Math.max(...v12.staffByProfSp[prof.id])}</td>
        </tr>`).join('')}

      <tr style="background:#f8fafc;font-weight:700;"><td class="col-sticky-name" colspan="${data.months.length + 2}">4. Вспомогательный персонал и итог</td></tr>
      <tr><td class="col-sticky-name" style="padding-left:18px;">Вспомогательные службы</td>${data.months.map((_,i)=>`<td style="text-align:right;">${v8.auxStaffSpTotal[i].toFixed(1)} / ${v12.auxStaffSpTotal[i].toFixed(1)}</td>`).join('')}<td>—</td></tr>
      <tr style="font-weight:700;background:#e2e8f0;font-size:13.5px;"><td class="col-sticky-name">ИТОГО ОБЩИЙ ШТАТ ЗАВОДА</td>${data.months.map((_,i)=>`<td style="text-align:right;color:var(--accent);font-weight:800;">${v8.grandTotalStaff[i]} / ${v12.grandTotalStaff[i]}</td>`).join('')}<td style="text-align:right;color:var(--accent);font-weight:800;">${Math.max(...v8.grandTotalStaff)} / ${Math.max(...v12.grandTotalStaff)}</td></tr>
    `;
    return;
  }

  const view = getView(calc, mode);
  const modeTitle = mode === 'auto' ? 'Авто: режим определяется по каждому месяцу' : mode === '8h' ? 'Фиксированный расчёт: 8 ч' : 'Фиксированный расчёт: 12 ч';
  thead.innerHTML = `<th class="col-sticky-name" style="min-width:260px;">Показатель / Пул квалификации</th>${data.months.map((m,i)=>`<th style="text-align:right;min-width:100px;">${m}<div style="margin-top:2px;">${modeChip(mode,calc,i)}</div></th>`).join('')}<th style="text-align:right;min-width:105px;">Итого / Среднее</th>`;

  tbody.innerHTML = `
    <tr><td class="col-sticky-name" colspan="${data.months.length+2}" style="background:#eef2ff;color:#3730a3;font-weight:700;">${modeTitle}. Численность считается с учётом минимального состава выделенных постов и дополнительных сменных звеньев по трудоёмкости.</td></tr>
    <tr style="background:#f8fafc;font-weight:700;"><td class="col-sticky-name" colspan="${data.months.length+2}">1. Прямая трудоёмкость по операциям (н-ч)</td></tr>
    ${data.professions.map(prof=>{const row=calc.hoursByProf[prof.id];const total=row.reduce((a,b)=>a+b,0);return `<tr><td class="col-sticky-name" style="padding-left:18px;">${prof.name}<span class="${prof.pool==='universal'?'badge-pool-universal':'badge-pool-dedicated'}" style="font-size:10px;margin-left:6px;">${prof.pool==='universal'?'Универсал':'Выделенный'}</span></td>${row.map(h=>`<td style="text-align:right;">${Math.round(h).toLocaleString()}</td>`).join('')}<td style="text-align:right;font-weight:600;">${Math.round(total).toLocaleString()}</td></tr>`;}).join('')}
    <tr style="font-weight:700;background:#f1f5f9;"><td class="col-sticky-name">ИТОГО прямая трудоёмкость (н-ч)</td>${calc.totalHoursByMonth.map(h=>`<td style="text-align:right;">${Math.round(h).toLocaleString()}</td>`).join('')}<td style="text-align:right;color:var(--accent);">${Math.round(calc.totalHoursByMonth.reduce((a,b)=>a+b,0)).toLocaleString()}</td></tr>
    <tr style="background:#e0f2fe;font-weight:700;color:#0369a1;"><td class="col-sticky-name" colspan="${data.months.length+2}">2. Универсальный пул (${calc.brigadesCount} бриг. по ${calc.brigadeSize} чел)</td></tr>
    <tr style="font-weight:700;background:#f0f9ff;"><td class="col-sticky-name" style="padding-left:18px;color:#0369a1;">ШТАТ УНИВЕРСАЛОВ (чел.)</td>${view.universalStaffSpTotal.map(s=>`<td style="text-align:right;color:#0369a1;font-weight:700;">${s.toFixed(1)}</td>`).join('')}<td style="text-align:right;font-weight:700;">${(view.universalStaffSpTotal.reduce((a,b)=>a+b,0)/view.universalStaffSpTotal.length).toFixed(1)}</td></tr>
    <tr style="font-weight:600;background:#f0f9ff;"><td class="col-sticky-name" style="padding-left:18px;color:#0369a1;">РЕЖИМ СМЕН</td>${view.universalSchedules.map(sc=>`<td style="text-align:right;font-size:11px;"><span class="${sc.badgeClass}">${sc.mode}</span></td>`).join('')}<td style="text-align:right;font-size:11px;">—</td></tr>
    ${calc.universalProfs.map(prof=>{const row=view.staffByProfSp[prof.id];const avg=(row.reduce((a,b)=>a+b,0)/row.length).toFixed(1);return `<tr style="color:var(--text-secondary);"><td class="col-sticky-name" style="padding-left:32px;font-size:12px;">↳ ${prof.name}</td>${row.map(s=>`<td style="text-align:right;font-size:12px;">${s.toFixed(1)}</td>`).join('')}<td style="text-align:right;font-size:12px;">${avg}</td></tr>`;}).join('')}
    <tr style="background:#fef3c7;font-weight:700;color:#92400e;"><td class="col-sticky-name" colspan="${data.months.length+2}">3. Выделенные посты (без ротации)</td></tr>
    ${calc.dedicatedProfs.map(prof=>{const row=view.staffByProfSp[prof.id];const avg=(row.reduce((a,b)=>a+b,0)/row.length).toFixed(1);return `<tr><td class="col-sticky-name" style="padding-left:18px;">${prof.name}</td>${data.months.map((_,i)=>`<td style="text-align:right;">${dedicatedCell(calc,data,prof.id,i,mode)}</td>`).join('')}<td style="text-align:right;font-weight:600;">${avg}</td></tr>`;}).join('')}
    <tr style="background:#f8fafc;font-weight:700;"><td class="col-sticky-name" colspan="${data.months.length+2}">4. Вспомогательный персонал и итоговый штат</td></tr>
    <tr><td class="col-sticky-name" style="padding-left:18px;">Вспомогательные службы</td>${view.auxStaffSpTotal.map(s=>`<td style="text-align:right;">${s.toFixed(1)}</td>`).join('')}<td style="text-align:right;font-weight:600;">${(view.auxStaffSpTotal.reduce((a,b)=>a+b,0)/view.auxStaffSpTotal.length).toFixed(1)}</td></tr>
    <tr style="font-weight:700;background:#e2e8f0;font-size:13.5px;"><td class="col-sticky-name">ИТОГО ОБЩИЙ ШТАТ ЗАВОДА</td>${view.grandTotalStaff.map(s=>`<td style="text-align:right;color:var(--accent);font-weight:800;">${s}</td>`).join('')}<td style="text-align:right;color:var(--accent);font-weight:800;">max: ${Math.max(...view.grandTotalStaff)}</td></tr>
  `;
}