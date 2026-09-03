// src/ui/tables/resultsTable.ts
import { ScenarioData, CalculationResult } from '../../types';

export function renderShiftScheduleTable(calc: CalculationResult, data: ScenarioData): void {
  const thead = document.getElementById("shiftScheduleTableHeader");
  const tbody = document.getElementById("shiftScheduleTableBody");
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <th class="col-sticky-name" style="min-width: 240px;">Участок / Оборудование</th>
    <th style="width: 65px; text-align: center;">Станков</th>
    <th style="width: 75px; text-align: center;">Звено</th>
    <th style="width: 90px; text-align: center;">Доступность</th>
    ${data.months.map(m => `<th style="text-align: center; min-width: 110px;">${m}</th>`).join("")}
  `;

  tbody.innerHTML = data.professions.map(prof => {
    const machines = Math.max(1, prof.machines || 1);
    const crew = Math.max(1, prof.crew || 1);
    const availabilityHours = Math.max(calc.shiftHoursStandard, Math.min(24, prof.availabilityHours || 24));
    const poolType = prof.pool || "universal";

    return `
      <tr>
        <td class="col-sticky-name">
          <strong>${prof.name}</strong>
          <span class="${poolType === 'universal' ? 'badge-pool-universal' : 'badge-pool-dedicated'}" style="font-size:10px; margin-left:6px;">
            ${poolType === 'universal' ? 'Универсал' : 'Выделенный'}
          </span>
        </td>
        <td style="text-align: center; font-weight:600;">${machines}</td>
        <td style="text-align: center; color:var(--text-secondary);">${crew} чел</td>
        <td style="text-align: center; color:var(--text-secondary);">${availabilityHours === 24 ? 'не огранич.' : availabilityHours + 'ч/сут'}</td>
        ${data.months.map((_, mIdx) => {
          const zone = calc.profMachineZones[prof.id][mIdx];
          return `<td style="text-align: center;">${zone.label}</td>`;
        }).join("")}
      </tr>
    `;
  }).join("");
}

export function renderResultsTable(calc: CalculationResult, data: ScenarioData): void {
  const thead = document.getElementById("resultsTableHeader");
  const tbody = document.getElementById("resultsTableBody");
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <th class="col-sticky-name" style="min-width: 260px;">Показатель / Пул квалификации</th>
    ${data.months.map(m => `<th style="text-align: right; min-width: 80px;">${m}</th>`).join("")}
    <th style="text-align: right; min-width: 105px;">Итого / Среднее</th>
  `;

  tbody.innerHTML = `
    <!-- 1. Прямая трудоёмкость -->
    <tr style="background:#f8fafc; font-weight:700;"><td class="col-sticky-name" colspan="${data.months.length + 2}">1. Прямая трудоёмкость по операциям (н-ч)</td></tr>
    ${data.professions.map(prof => {
      const rowHours = calc.hoursByProf[prof.id];
      const sumHours = rowHours.reduce((a, b) => a + b, 0);
      return `
        <tr>
          <td class="col-sticky-name" style="padding-left: 18px;">
            ${prof.name}
            <span class="${prof.pool === 'universal' ? 'badge-pool-universal' : 'badge-pool-dedicated'}" style="font-size:10px; margin-left:6px;">
              ${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'}
            </span>
          </td>
          ${rowHours.map(h => `<td style="text-align: right;">${Math.round(h).toLocaleString()}</td>`).join("")}
          <td style="text-align: right; font-weight:600;">${Math.round(sumHours).toLocaleString()}</td>
        </tr>
      `;
    }).join("")}
    <tr style="font-weight:700; background:#f1f5f9;">
      <td class="col-sticky-name">ИТОГО прямая трудоёмкость (н-ч):</td>
      ${calc.totalHoursByMonth.map(h => `<td style="text-align: right;">${Math.round(h).toLocaleString()}</td>`).join("")}
      <td style="text-align: right; color:var(--accent);">${Math.round(calc.totalHoursByMonth.reduce((a,b)=>a+b, 0)).toLocaleString()}</td>
    </tr>

    <!-- 2. Универсальный пул с вложенными строками со стрелочками ↳ -->
    <tr style="background:#e0f2fe; font-weight:700; color:#0369a1;"><td class="col-sticky-name" colspan="${data.months.length + 2}">2. Универсальный пул (${calc.brigadesCount} бригад(ы) по ${calc.brigadeSize} чел)</td></tr>
    <tr style="font-weight:700; background:#f0f9ff;">
      <td class="col-sticky-name" style="padding-left: 18px; color:#0369a1;">ШТАТ УНИВЕРСАЛОВ (чел.):</td>
      ${calc.universalStaffSpTotal.map(s => `<td style="text-align: right; color:#0369a1; font-weight:700;">${s.toFixed(1)}</td>`).join("")}
      <td style="text-align: right; font-weight:700; color:#0369a1;">${(calc.universalStaffSpTotal.reduce((a,b)=>a+b,0)/calc.universalStaffSpTotal.length).toFixed(1)}</td>
    </tr>
    <tr style="font-weight:600; background:#f0f9ff;">
      <td class="col-sticky-name" style="padding-left: 18px; color:#0369a1;">РЕКОМЕНДУЕМЫЙ РЕЖИМ СМЕН:</td>
      ${calc.universalSchedules.map(sc => `<td style="text-align: right; font-size:11px; font-weight:700;"><span class="${sc.badgeClass}">${sc.mode}</span></td>`).join("")}
      <td style="text-align: right; font-size:11px; color:#0369a1;">—</td>
    </tr>
    ${calc.universalProfs.map(prof => {
      const rowStaff = calc.staffByProfSp[prof.id];
      const avgStaff = (rowStaff.reduce((a, b) => a + b, 0) / rowStaff.length).toFixed(1);
      return `
        <tr style="color:var(--text-secondary);">
          <td class="col-sticky-name" style="padding-left: 32px; font-size:12px;">↳ ${prof.name}</td>
          ${rowStaff.map(s => `<td style="text-align: right; font-size:12px;">${s.toFixed(1)}</td>`).join("")}
          <td style="text-align: right; font-size:12px;">${avgStaff}</td>
        </tr>
      `;
    }).join("")}

    <!-- 3. Выделенные посты -->
    <tr style="background:#fef3c7; font-weight:700; color:#92400e;"><td class="col-sticky-name" colspan="${data.months.length + 2}">3. Выделенные посты (Без ротации)</td></tr>
    ${calc.dedicatedProfs.map(prof => {
      const rowStaff = calc.staffByProfSp[prof.id];
      const avgStaff = (rowStaff.reduce((a, b) => a + b, 0) / rowStaff.length).toFixed(1);
      return `
        <tr>
          <td class="col-sticky-name" style="padding-left: 18px;">${prof.name}</td>
          ${rowStaff.map(s => `<td style="text-align: right;">${s.toFixed(1)}</td>`).join("")}
          <td style="text-align: right; font-weight:600;">${avgStaff}</td>
        </tr>
      `;
    }).join("")}

    <!-- 4. Вспомогательный персонал и Итого -->
    <tr style="background:#f8fafc; font-weight:700;"><td class="col-sticky-name" colspan="${data.months.length + 2}">4. Вспомогательный персонал и Итоговый штат</td></tr>
    <tr>
      <td class="col-sticky-name" style="padding-left: 18px;">Вспомогательные службы (ОТК, наладка, дежурные)</td>
      ${calc.auxStaffSpTotal.map(s => `<td style="text-align: right;">${s.toFixed(1)}</td>`).join("")}
      <td style="text-align: right; font-weight:600;">${(calc.auxStaffSpTotal.reduce((a,b)=>a+b,0)/calc.auxStaffSpTotal.length).toFixed(1)}</td>
    </tr>
    <tr style="font-weight:700; background:#e2e8f0; font-size:13.5px;">
      <td class="col-sticky-name">ИТОГО ОБЩИЙ ШТАТ ЗАВОДА (чел., с округлением):</td>
      ${calc.grandTotalStaff.map(s => `<td style="text-align: right; color:var(--accent); font-weight:800;">${s}</td>`).join("")}
      <td style="text-align: right; color:var(--accent); font-weight:800;">max: ${Math.max(...calc.grandTotalStaff)}</td>
    </tr>
  `;
}
