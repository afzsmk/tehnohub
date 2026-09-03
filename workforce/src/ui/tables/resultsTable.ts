// src/ui/tables/resultsTable.ts
import { ScenarioData, CalculationResult } from '../../types';

export function renderShiftScheduleTable(calc: CalculationResult, data: ScenarioData): void {
  const thead = document.getElementById("shiftScheduleTableHeader");
  const tbody = document.getElementById("shiftScheduleTableBody");
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <th class="col-sticky-name" style="min-width: 220px;">Участок / Оборудование</th>
    <th style="width: 65px; text-align: center;">Станков</th>
    <th style="width: 75px; text-align: center;">Звено</th>
    ${data.months.map(m => `<th style="text-align: center; min-width: 110px;">${m}</th>`).join("")}
  `;

  tbody.innerHTML = data.professions.map(prof => `
    <tr>
      <td class="col-sticky-name">
        <strong>${prof.name}</strong>
        <span class="${prof.pool === 'universal' ? 'badge-pool-universal' : 'badge-pool-dedicated'}" style="font-size:10px; margin-left:6px;">
          ${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'}
        </span>
      </td>
      <td style="text-align:center; font-weight:600;">${prof.machines || 1}</td>
      <td style="text-align:center; color:var(--text-secondary);">${prof.crew || 1} чел</td>
      ${data.months.map((_, mIdx) => {
        const zone = calc.profMachineZones[prof.id][mIdx];
        return `<td style="text-align:center;">${zone.label}</td>`;
      }).join("")}
    </tr>
  `).join("");
}

export function renderResultsTable(calc: CalculationResult, data: ScenarioData): void {
  const thead = document.getElementById("resultsTableHeader");
  const tbody = document.getElementById("resultsTableBody");
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <th class="col-sticky-name" style="min-width: 250px;">Показатель / Пул квалификации</th>
    ${data.months.map(m => `<th style="text-align: right; min-width: 80px;">${m}</th>`).join("")}
    <th style="text-align: right; min-width: 100px;">Итого / Среднее</th>
  `;

  tbody.innerHTML = `
    <!-- 1. Прямая трудоемкость -->
    <tr style="background:#f8fafc; font-weight:700;"><td class="col-sticky-name" colspan="${data.months.length + 2}">1. Прямая трудоёмкость по операциям (н-ч)</td></tr>
    ${data.professions.map(prof => {
      const rowHours = calc.hoursByProf[prof.id];
      const sumH = rowHours.reduce((a, b) => a + b, 0);
      return `
        <tr>
          <td class="col-sticky-name" style="padding-left:18px;">${prof.name}</td>
          ${rowHours.map(h => `<td style="text-align:right;">${Math.round(h).toLocaleString()}</td>`).join("")}
          <td style="text-align:right; font-weight:600;">${Math.round(sumH).toLocaleString()}</td>
        </tr>
      `;
    }).join("")}

    <!-- 2. Универсалы -->
    <tr style="background:#e0f2fe; font-weight:700; color:#0369a1;"><td class="col-sticky-name" colspan="${data.months.length + 2}">2. Универсальный пул (${calc.brigadesCount} бриг. по ${calc.brigadeSize} чел)</td></tr>
    <tr style="font-weight:700; background:#f0f9ff;">
      <td class="col-sticky-name" style="padding-left:18px; color:#0369a1;">ШТАТ УНИВЕРСАЛОВ (чел.):</td>
      ${calc.universalStaffSpTotal.map(s => `<td style="text-align:right; color:#0369a1;">${s.toFixed(1)}</td>`).join("")}
      <td style="text-align:right; color:#0369a1;">${(calc.universalStaffSpTotal.reduce((a, b) => a + b, 0) / calc.universalStaffSpTotal.length).toFixed(1)}</td>
    </tr>

    <!-- 3. Выделенные -->
    <tr style="background:#fef3c7; font-weight:700; color:#92400e;"><td class="col-sticky-name" colspan="${data.months.length + 2}">3. Выделенные посты</td></tr>
    ${calc.dedicatedProfs.map(prof => {
      const rowS = calc.staffByProfSp[prof.id];
      const avgS = (rowS.reduce((a, b) => a + b, 0) / rowS.length).toFixed(1);
      return `
        <tr>
          <td class="col-sticky-name" style="padding-left:18px;">${prof.name}</td>
          ${rowS.map(s => `<td style="text-align:right;">${s.toFixed(1)}</td>`).join("")}
          <td style="text-align:right; font-weight:600;">${avgS}</td>
        </tr>
      `;
    }).join("")}

    <!-- 4. Итого -->
    <tr style="font-weight:800; background:#e2e8f0; font-size:13.5px;">
      <td class="col-sticky-name">ИТОГО ОБЩИЙ ШТАТ ЗАВОДА (чел.):</td>
      ${calc.grandTotalStaff.map(s => `<td style="text-align:right; color:var(--accent);">${s}</td>`).join("")}
      <td style="text-align:right; color:var(--accent);">max: ${Math.max(...calc.grandTotalStaff)}</td>
    </tr>
  `;
}
