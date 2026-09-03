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

  return `
    <div class="rpt-page rpt-title-page">
      <h1>${escapeHtml(companyName)}</h1>
      <div class="rpt-scenario">Отчёт по производственной программе: «${escapeHtml(currentScenario)}»</div>
      <div class="rpt-meta">
        Период: ${escapeHtml(data.months[0])} — ${escapeHtml(data.months[data.months.length - 1])} (${data.months.length} мес.)<br>
        Дата формирования отчёта: ${now}<br>
        Статус программы: <strong>${zoneLabels[calc.overallZone] || ''}</strong>
      </div>
    </div>

    <div class="rpt-page">
      <div class="rpt-section-title">1. Резюме для руководителя</div>
      <div class="rpt-summary-grid">
        <div class="rpt-summary-box"><div class="lbl">Статус</div><div class="val">${zoneLabels[calc.overallZone] || ''}</div></div>
        <div class="rpt-summary-box"><div class="lbl">Пиковый штат</div><div class="val">${peakStaff} чел.${peakIdx >= 0 ? ` (${escapeHtml(data.months[peakIdx])})` : ''}</div></div>
        <div class="rpt-summary-box"><div class="lbl">Узкое место</div><div class="val">${escapeHtml(bottleneckName)}</div></div>
        <div class="rpt-summary-box"><div class="lbl">Номенклатура</div><div class="val">${data.products.length} поз.</div></div>
      </div>
    </div>

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
  `;
}