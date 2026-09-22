// src/services/reportService.ts
import { ScenarioData, CalculationResult, AnalysisDisplayMode, WorkforceMode, WorkforceView } from '../types';
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

export function buildPrintReportHtml(currentScenario: string, data: ScenarioData, calc: CalculationResult, displayMode: AnalysisDisplayMode = 'auto'): string {
  const now = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const companyName = data.settings.companyName?.trim() || 'Производственная программа';
  const zoneLabels: Record<string, string> = { green: 'Программа выполнима', yellow: 'Выполнима с оговорками', red: 'Требует пересмотра' };
  const modeLabels: Record<WorkforceMode, string> = { auto: 'Авто', '8h': '8 ч', '12h': '12 ч' };
  const modeTitle = displayMode === 'compare' ? 'Сравнение 8 ч / 12 ч' : modeLabels[displayMode];
  const view: WorkforceView = displayMode === '8h' ? calc.workforceViews['8h'] : displayMode === '12h' ? calc.workforceViews['12h'] : calc.workforceViews.auto;

  const peakStaff = view.grandTotalStaff.length ? Math.max(...view.grandTotalStaff) : 0;
  const peakIdx = view.grandTotalStaff.indexOf(peakStaff);
  const peak8 = Math.max(...calc.workforceViews['8h'].grandTotalStaff);
  const peak12 = Math.max(...calc.workforceViews['12h'].grandTotalStaff);

  let bottleneckName = '—';
  let bottleneckHours = -1;
  data.professions.forEach(prof => {
    const sumH = calc.hoursByProf[prof.id].reduce((a: number, b: number) => a + b, 0);
    if (sumH > bottleneckHours) { bottleneckHours = sumH; bottleneckName = prof.name; }
  });

  const advisorSrc = document.getElementById('advisorList');
  const advisorHtml = advisorSrc ? advisorSrc.innerHTML.replace(/<button[^>]*>.*?<\/button>/gs, '') : '';

  function staffingTable(mode: WorkforceMode): string {
    const v = calc.workforceViews[mode];
    return `
      <table class='rpt-table'>
        <thead><tr><th>Пул / показатель</th>${data.months.map((m, i) => `<th>${escapeHtml(m)}<br><span style='font-size:9px;'>${escapeHtml(v.universalSchedules[i]?.mode || modeLabels[mode])}</span></th>`).join('')}</tr></thead>
        <tbody>
          <tr><td>Универсальный пул (${calc.brigadesCount}×${calc.brigadeSize} чел.)</td>${v.universalStaffSpTotal.map(x => `<td>${x.toFixed(1)}</td>`).join('')}</tr>
          ${calc.universalProfs.map(prof => `<tr><td style='padding-left:16px;color:#64748b;'>↳ ${escapeHtml(prof.name)}</td>${v.staffByProfSp[prof.id].map(x => `<td>${x.toFixed(1)}</td>`).join('')}</tr>`).join('')}
          ${calc.dedicatedProfs.map(prof => `<tr><td>↳ ${escapeHtml(prof.name)} (выделенный)</td>${v.staffByProfSp[prof.id].map((x, i) => { const d = v.dedicatedDetails[prof.id][i]; return `<td>${Math.round(x)}<br><span style='font-size:8.5px;color:#64748b;'>мин. ${d.minimumStaff}; ${d.requiredTeams} зв.; ${d.shiftHours}ч</span></td>`; }).join('')}</tr>`).join('')}
          <tr><td>Вспомогательный персонал</td>${v.auxStaffSpTotal.map(x => `<td>${x.toFixed(1)}</td>`).join('')}</tr>
          <tr><td><strong>ИТОГО ШТАТ</strong></td>${v.grandTotalStaff.map(x => `<td><strong>${x}</strong></td>`).join('')}</tr>
        </tbody>
      </table>`;
  }

  function comparisonTable(): string {
    const v8 = calc.workforceViews['8h'];
    const v12 = calc.workforceViews['12h'];
    return `
      <table class='rpt-table'>
        <thead><tr><th>Пул / показатель</th>${data.months.flatMap(m => [`<th>${escapeHtml(m)}<br><span style='font-size:9px;'>8 ч</span></th>`, `<th>${escapeHtml(m)}<br><span style='font-size:9px;'>12 ч</span></th>`]).join('')}</tr></thead>
        <tbody>
          <tr><td>Универсальный пул</td>${data.months.flatMap((_, i) => [`<td>${v8.universalStaffSpTotal[i].toFixed(1)}</td>`, `<td>${v12.universalStaffSpTotal[i].toFixed(1)}</td>`]).join('')}</tr>
          ${calc.dedicatedProfs.map(prof => `<tr><td>Выделенный: ${escapeHtml(prof.name)}</td>${data.months.flatMap((_, i) => [`<td>${Math.round(v8.staffByProfSp[prof.id][i])}</td>`, `<td>${Math.round(v12.staffByProfSp[prof.id][i])}</td>`]).join('')}</tr>`).join('')}
          <tr><td>Вспомогательный персонал</td>${data.months.flatMap((_, i) => [`<td>${v8.auxStaffSpTotal[i].toFixed(1)}</td>`, `<td>${v12.auxStaffSpTotal[i].toFixed(1)}</td>`]).join('')}</tr>
          <tr><td><strong>ИТОГО ШТАТ</strong></td>${data.months.flatMap((_, i) => [`<td><strong>${v8.grandTotalStaff[i]}</strong></td>`, `<td><strong>${v12.grandTotalStaff[i]}</strong></td>`]).join('')}</tr>
        </tbody>
      </table>`;
  }

  return `
    <div class='rpt-page rpt-title-page'>
      <h1>${escapeHtml(companyName)}</h1>
      <div class='rpt-scenario'>Отчёт по производственной программе: «${escapeHtml(currentScenario)}»</div>
      <div class='rpt-meta'>
        Режим аналитического расчёта: <strong>${escapeHtml(modeTitle)}</strong><br>
        Период: ${escapeHtml(data.months[0])} — ${escapeHtml(data.months[data.months.length - 1])} (${data.months.length} мес.)<br>
        Дата формирования отчёта: ${now}<br>
        Статус программы: <strong>${zoneLabels[calc.overallZone] || ''}</strong>
      </div>
    </div>

    <div class='rpt-page'>
      <div class='rpt-section-title'>1. Резюме для руководителя</div>
      <div class='rpt-summary-grid'>
        <div class='rpt-summary-box'><div class='lbl'>Режим</div><div class='val'>${escapeHtml(modeTitle)}</div></div>
        <div class='rpt-summary-box'><div class='lbl'>Пиковый штат</div><div class='val'>${displayMode === 'compare' ? `${peak8} / ${peak12} чел.` : `${peakStaff} чел.${peakIdx >= 0 ? ` (${escapeHtml(data.months[peakIdx])})` : ''}`}</div></div>
        <div class='rpt-summary-box'><div class='lbl'>Узкое место</div><div class='val'>${escapeHtml(bottleneckName)}</div></div>
        <div class='rpt-summary-box'><div class='lbl'>Номенклатура</div><div class='val'>${data.products.length} поз.</div></div>
      </div>
      <div class='rpt-section-title' style='margin-top:20px;'>Пояснение</div>
      <div class='rpt-footer-note'>В расчёте выделенных постов параметр crew × machines задаёт минимальный состав. При недостаточности фонда времени добавляются полные сменные звенья. Оборудование учитывает индивидуальную доступность.</div>
      <div class='rpt-section-title' style='margin-top:20px;'>Рекомендации автоматического советника</div>
      <div>${advisorHtml}</div>
    </div>

    <div class='rpt-page'>
      <div class='rpt-section-title'>2. Производственный план выпуска</div>
      <table class='rpt-table'>
        <thead><tr><th>Изделие</th><th>Ед.</th>${data.months.map(m => `<th>${escapeHtml(m)}</th>`).join('')}<th>Итого</th></tr></thead>
        <tbody>${data.products.map(p => { const row = data.plan[p.id] || []; const total = row.reduce((a, b) => a + parseNum(b), 0); return `<tr><td>${escapeHtml(p.name)}</td><td style='text-align:center;'>${escapeHtml(p.unit || '')}</td>${row.map(v => `<td>${parseNum(v).toLocaleString()}</td>`).join('')}<td><strong>${total.toLocaleString()}</strong></td></tr>`; }).join('')}</tbody>
      </table>
    </div>

    <div class='rpt-page'>
      <div class='rpt-section-title'>3. Трудоёмкость по технологическим участкам (н-ч)</div>
      <table class='rpt-table'>
        <thead><tr><th>Участок</th><th>Пул</th>${data.months.map(m => `<th>${escapeHtml(m)}</th>`).join('')}<th>Итого</th></tr></thead>
        <tbody>
          ${data.professions.map(prof => { const row = calc.hoursByProf[prof.id]; const total = row.reduce((a, b) => a + b, 0); return `<tr><td>${escapeHtml(prof.name)}</td><td style='text-align:center;'>${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'}</td>${row.map(h => `<td>${Math.round(h).toLocaleString()}</td>`).join('')}<td><strong>${Math.round(total).toLocaleString()}</strong></td></tr>`; }).join('')}
          <tr><td colspan='2'><strong>ИТОГО</strong></td>${calc.totalHoursByMonth.map(h => `<td><strong>${Math.round(h).toLocaleString()}</strong></td>`).join('')}<td><strong>${Math.round(calc.totalHoursByMonth.reduce((a, b) => a + b, 0)).toLocaleString()}</strong></td></tr>
        </tbody>
      </table>
    </div>

    <div class='rpt-page'>
      <div class='rpt-section-title'>4. Расчёт потребного штата — ${escapeHtml(modeTitle)}</div>
      ${displayMode === 'compare' ? comparisonTable() : staffingTable(displayMode)}
    </div>

    <div class='rpt-page'>
      <div class='rpt-section-title'>5. Загрузка оборудования и постов</div>
      <table class='rpt-table'>
        <thead><tr><th>Участок</th>${data.months.map(m => `<th>${escapeHtml(m)}</th>`).join('')}</tr></thead>
        <tbody>${data.professions.map(prof => `<tr><td>${escapeHtml(prof.name)} <span style='font-size:9.5px;color:#64748b;'>(${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'})</span></td>${calc.profMachineZones[prof.id].map(z => `<td class='${zoneCellClass(z.statusZone)}'>${escapeHtml(z.plainLabel) || '—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <div class='rpt-footer-note'>Физическая загрузка оборудования не зависит от режима отображения штата. При наличии доступности 24 ч загрузка свыше 12 ч/сут трактуется как несколько смен; красная зона означает превышение физической доступности оборудования.</div>
    </div>

    <div class='rpt-page'>
      <div class='rpt-section-title'>6. Приложение: реестр обоснованных технологических норм</div>
      ${(!data.normConfigs || Object.keys(data.normConfigs).length === 0) ? `<div class='rpt-footer-note'>Реестр пуст — нормы были введены вручную без сохранения обоснования расчёта.</div>` : `<table class='rpt-table'><thead><tr><th>Изделие</th><th>Участок</th><th>Метод</th><th>Норма, н-ч</th><th>Зафиксировано</th></tr></thead><tbody>${Object.values(data.normConfigs).map(item => `<tr><td>${escapeHtml(item.prodName)}</td><td>${escapeHtml(item.profName)}</td><td style='text-align:center;'>${item.method === 'stat' ? 'Статистич.' : 'Хронометраж'}</td><td>${item.norm}</td><td style='text-align:center;'>${escapeHtml(item.updatedAt || '')}</td></tr>`).join('')}</tbody></table>`}
      <div class='rpt-footer-note'>Отчёт сформирован автоматически инструментом производственного планирования ЗСМК.</div>
    </div>
  `;
}
