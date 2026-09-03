// src/services/reportService.ts
import { ScenarioData, CalculationResult } from '../types';
import { parseNum } from '../core/funds';

function escapeHtml(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function zoneCellClass(zone: string): string {
  if (zone === "red") return "rpt-zone-red";
  if (zone === "yellow") return "rpt-zone-yellow";
  if (zone === "green") return "rpt-zone-green";
  return "";
}

export function buildPrintReportHtml(currentScenario: string, data: ScenarioData, calc: CalculationResult): string {
  const now = new Date().toLocaleString("ru-RU", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const companyName = data.settings.companyName?.trim() || "Производственная программа";
  const zoneLabels: Record<string, string> = { green: "Программа выполнима", yellow: "Выполнима с оговорками", red: "Требует пересмотра" };
  const peakStaff = calc.grandTotalStaff.length ? Math.max(...calc.grandTotalStaff) : 0;
  const peakIdx = calc.grandTotalStaff.indexOf(peakStaff);

  let bottleneckName = "—";
  let bottleneckHours = -1;
  data.professions.forEach(prof => {
    const sumH = calc.hoursByProf[prof.id].reduce((a, b) => a + b, 0);
    if (sumH > bottleneckHours) { bottleneckHours = sumH; bottleneckName = prof.name; }
  });

  // Получаем рекомендации советника (без кнопок действий)
  const advisorSrc = document.getElementById("advisorList");
  const advisorHtml = advisorSrc ? advisorSrc.innerHTML.replace(/<button[^>]*>.*?<\/button>/gs, "") : "";

  return `
    <!-- ТИТУЛЬНЫЙ ЛИСТ -->
    <div class="rpt-page rpt-title-page">
      <h1>${escapeHtml(companyName)}</h1>
      <div class="rpt-scenario">Отчёт по производственной программе: «${escapeHtml(currentScenario)}»</div>
      <div class="rpt-meta">
        Период: ${escapeHtml(data.months[0])} — ${escapeHtml(data.months[data.months.length - 1])} (${data.months.length} мес.)<br>
        Дата формирования отчёта: ${now}<br>
        Статус программы: <strong>${zoneLabels[calc.overallZone] || ''}</strong>
      </div>
    </div>

    <!-- РАЗДЕЛ 1: РЕЗЮМЕ И СОВЕТНИК -->
    <div class="rpt-page">
      <div class="rpt-section-title">1. Резюме для руководителя</div>
      <div class="rpt-summary-grid">
        <div class="rpt-summary-box"><div class="lbl">Статус</div><div class="val">${zoneLabels[calc.overallZone] || ''}</div></div>
        <div class="rpt-summary-box"><div class="lbl">Пиковый штат</div><div class="val">${peakStaff} чел.${peakIdx >= 0 ? ` (${escapeHtml(data.months[peakIdx])})` : ''}</div></div>
        <div class="rpt-summary-box"><div class="lbl">Узкое место</div><div class="val">${escapeHtml(bottleneckName)}</div></div>
        <div class="rpt-summary-box"><div class="lbl">Номенклатура</div><div class="val">${data.products.length} поз.</div></div>
      </div>
      <div class="rpt-section-title" style="margin-top:20px;">Рекомендации автоматического советника</div>
      <div>${advisorHtml}</div>
    </div>

    <!-- РАЗДЕЛ 2: ПЛАН ВЫПУСКА -->
    <div class="rpt-page">
      <div class="rpt-section-title">2. Производственный план выпуска</div>
      <table class="rpt-table">
        <thead>
          <tr><th>Изделие</th><th>Ед.</th>${data.months.map(m => `<th>${escapeHtml(m)}</th>`).join("")}<th>Итого</th></tr>
        </thead>
        <tbody>
          ${data.products.map(p => {
            const row = data.plan[p.id] || [];
            const total = row.reduce((a, b) => a + parseNum(b), 0);
            return `<tr><td>${escapeHtml(p.name)}</td><td style="text-align:center;">${escapeHtml(p.unit || '')}</td>${row.map(v => `<td>${parseNum(v).toLocaleString()}</td>`).join("")}<td><strong>${total.toLocaleString()}</strong></td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <!-- РАЗДЕЛ 3: ТРУДОЕМКОСТЬ -->
    <div class="rpt-page">
      <div class="rpt-section-title">3. Трудоёмкость по технологическим участкам (н-ч)</div>
      <table class="rpt-table">
        <thead>
          <tr><th>Участок</th><th>Пул</th>${data.months.map(m => `<th>${escapeHtml(m)}</th>`).join("")}<th>Итого</th></tr>
        </thead>
        <tbody>
          ${data.professions.map(prof => {
            const row = calc.hoursByProf[prof.id];
            const total = row.reduce((a, b) => a + b, 0);
            return `<tr><td>${escapeHtml(prof.name)}</td><td style="text-align:center;">${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'}</td>${row.map(h => `<td>${Math.round(h).toLocaleString()}</td>`).join("")}<td><strong>${Math.round(total).toLocaleString()}</strong></td></tr>`;
          }).join("")}
          <tr><td colspan="2"><strong>ИТОГО</strong></td>${calc.totalHoursByMonth.map(h => `<td><strong>${Math.round(h).toLocaleString()}</strong></td>`).join("")}<td><strong>${Math.round(calc.totalHoursByMonth.reduce((a,b)=>a+b,0)).toLocaleString()}</strong></td></tr>
        </tbody>
      </table>
    </div>

    <!-- РАЗДЕЛ 4: ШТАТНОЕ РАСПИСАНИЕ -->
    <div class="rpt-page">
      <div class="rpt-section-title">4. Расчёт потребного штата по пулам квалификации (чел.)</div>
      <table class="rpt-table">
        <thead>
          <tr><th>Пул / показатель</th>${data.months.map(m => `<th>${escapeHtml(m)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          <tr><td>Универсальный пул (${calc.brigadesCount}×${calc.brigadeSize} чел.)</td>${calc.universalStaffSpTotal.map(v => `<td>${v.toFixed(1)}</td>`).join("")}</tr>
          ${calc.universalProfs.map(prof => `
            <tr><td style="padding-left:16px; color:#64748b;">↳ ${escapeHtml(prof.name)}</td>${calc.staffByProfSp[prof.id].map(v => `<td>${v.toFixed(1)}</td>`).join("")}</tr>
          `).join("")}
          ${calc.dedicatedProfs.map(prof => `
            <tr><td>↳ ${escapeHtml(prof.name)} (выделенный)</td>${calc.staffByProfSp[prof.id].map(v => `<td>${v.toFixed(1)}</td>`).join("")}</tr>
          `).join("")}
          <tr><td>Вспомогательный персонал</td>${calc.auxStaffSpTotal.map(v => `<td>${v.toFixed(1)}</td>`).join("")}</tr>
          <tr><td><strong>ИТОГО ШТАТ</strong></td>${calc.grandTotalStaff.map(v => `<td><strong>${v}</strong></td>`).join("")}</tr>
        </tbody>
      </table>
    </div>

    <!-- РАЗДЕЛ 5: ЗАГРУЗКА ОБОРУДОВАНИЯ -->
    <div class="rpt-page">
      <div class="rpt-section-title">5. Режим загрузки оборудования по участкам</div>
      <table class="rpt-table">
        <thead>
          <tr><th>Участок</th>${data.months.map(m => `<th>${escapeHtml(m)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${data.professions.map(prof => `
            <tr>
              <td>${escapeHtml(prof.name)} <span style="font-size:9.5px; color:#64748b;">(${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'})</span></td>
              ${calc.profMachineZones[prof.id].map(z => `<td class="${zoneCellClass(z.statusZone)}">${escapeHtml(z.plainLabel) || "—"}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="rpt-footer-note">Пороги режимов рассчитаны при: ${calc.workDaysPerMonth} раб.дн./мес, смена ${calc.shiftHoursStandard}ч (норма) / до ${calc.extendedShiftHours}ч (усиленный режим), с учётом индивидуальной доступности оборудования.</div>
    </div>

    <!-- РАЗДЕЛ 6: РЕЕСТР НОРМ -->
    <div class="rpt-page">
      <div class="rpt-section-title">6. Приложение: реестр обоснованных технологических норм</div>
      ${(!data.normConfigs || Object.keys(data.normConfigs).length === 0)
        ? `<div class="rpt-footer-note">Реестр пуст — нормы были введены вручную без сохранения обоснования расчёта.</div>`
        : `
          <table class="rpt-table">
            <thead>
              <tr><th>Изделие</th><th>Участок</th><th>Метод</th><th>Норма, н-ч</th><th>Зафиксировано</th></tr>
            </thead>
            <tbody>
              ${Object.values(data.normConfigs).map(item => `
                <tr>
                  <td>${escapeHtml(item.prodName)}</td>
                  <td>${escapeHtml(item.profName)}</td>
                  <td style="text-align:center;">${item.method === 'stat' ? 'Статистич.' : 'Хронометраж'}</td>
                  <td>${item.norm}</td>
                  <td style="text-align:center;">${escapeHtml(item.updatedAt || '')}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
      }
      <div class="rpt-footer-note">Отчёт сформирован автоматически инструментом производственного планирования ЗСМК.</div>
    </div>
  `;
}
