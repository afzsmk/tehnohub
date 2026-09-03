// src/main.ts
import html2canvas from 'html2canvas';
import { AppState, ScenarioData } from './types';
import { calculateProgram } from './core/engine';
import { parseNum } from './core/funds';
import { levelLoadPlan } from './core/levelLoading';
import { calculateStatNorm, calculateChronoNorm } from './core/norming';
import { storageService } from './services/storage/storageService';
import { exportToExcel, downloadPlanTemplate, parsePlanExcel } from './services/excelService';
import { buildPrintReportHtml } from './services/reportService';
import { modalSystem } from './ui/modal';
import { renderCharts } from './ui/charts';

let state: AppState;

function getActiveData(): ScenarioData {
  return state.scenarios[state.currentScenario];
}

async function init() {
  modalSystem.init();
  state = await storageService.loadState();
  renderScenarioSelector();
  setupTabs();
  attachEvents();
  renderAll();
}

function renderAll() {
  const data = getActiveData();
  const calc = calculateProgram(data);

  renderKPIs(calc, data);
  renderPlanTable(data, calc);
  renderCharts(calc, data);
}

function renderScenarioSelector() {
  const selector = document.getElementById("scenarioSelector") as HTMLSelectElement;
  if (!selector) return;
  selector.innerHTML = "";
  Object.keys(state.scenarios).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === state.currentScenario) opt.selected = true;
    selector.appendChild(opt);
  });
}

function renderKPIs(calc: any, data: ScenarioData) {
  const totalHours = calc.totalHoursByMonth.reduce((a: number, b: number) => a + b, 0);
  const peakStaff = Math.max(...calc.grandTotalStaff);
  const avgStaff = (calc.grandTotalStaff.reduce((a: number, b: number) => a + b, 0) / calc.grandTotalStaff.length).toFixed(1);

  document.getElementById("kpiTotalProducts")!.textContent = `${data.products.length} поз.`;
  document.getElementById("kpiTotalHours")!.textContent = `${Math.round(totalHours).toLocaleString()} н-ч`;
  document.getElementById("kpiAvgStaff")!.textContent = `${avgStaff} чел.`;
  document.getElementById("execPeakValue")!.textContent = `${peakStaff} чел.`;

  const pill = document.getElementById("execStatusPill")!;
  pill.className = `status-pill status-zone-${calc.overallZone}`;
  pill.textContent = calc.overallZone === 'green' ? "✓ Программа выполнима" : "⚠ Требует внимания";
}

function renderPlanTable(data: ScenarioData, calc: any) {
  const header = document.getElementById("planTableHeader")!;
  header.innerHTML = `
    <th class="col-sticky-name">Изделие</th>
    <th style="width:75px; text-align:center;">Ед.</th>
    ${data.months.map(m => `<th style="text-align:center;">${m}</th>`).join("")}
    <th style="text-align:right;">Итого</th>
  `;

  const tbody = document.getElementById("planTableBody")!;
  tbody.innerHTML = data.products.map(p => {
    const row = data.plan[p.id] || [];
    const total = row.reduce((sum, v) => sum + parseNum(v), 0);
    return `
      <tr>
        <td class="col-sticky-name"><strong>${p.name}</strong></td>
        <td style="text-align:center;">${p.unit}</td>
        ${data.months.map((_, idx) => `
          <td><input type="text" class="input-control input-num plan-val" data-prod="${p.id}" data-month="${idx}" value="${row[idx] || 0}"></td>
        `).join("")}
        <td style="text-align:right; font-weight:700;">${total.toLocaleString()}</td>
      </tr>
    `;
  }).join("");

  const tfoot = document.getElementById("planTableFooter")!;
  tfoot.innerHTML = `
    <tr style="font-weight:700; background:#f8fafc;">
      <td colspan="2">ИТОГО ТРУДОЁМКОСТЬ:</td>
      ${calc.totalHoursByMonth.map((h: number) => `<td style="text-align:right;">${Math.round(h).toLocaleString()}</td>`).join("")}
      <td style="text-align:right; color:var(--accent);">${Math.round(calc.totalHoursByMonth.reduce((a: number, b: number) => a + b, 0)).toLocaleString()} н-ч</td>
    </tr>
  `;
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.getAttribute("data-tab");
      document.getElementById(tab!)?.classList.add("active");
    });
  });
}

function attachEvents() {
  // Выравнивание плана под штат
  document.getElementById("btnLevelToggle")?.addEventListener("click", () => {
    const data = getActiveData();
    modalSystem.prompt("Выравнивание плана", "Укажите целевую численность (чел.):", "25", (val) => {
      const target = parseInt(val);
      if (target > 0) {
        const res = levelLoadPlan(data, target);
        data.plan = res.updatedPlan;
        storageService.saveState(state);
        renderAll();
        modalSystem.alert("Успешно", `План перераспределен под ${target} чел. Сдвинуто ${Math.round(res.totalShiftedHours)} н-ч.`);
      }
    });
  });

  // Экспорт Excel
  document.getElementById("btnExportXlsx")?.addEventListener("click", () => {
    const data = getActiveData();
    const calc = calculateProgram(data);
    exportToExcel(state.currentScenario, data, calc);
  });

  // Скачать шаблон плана
  document.getElementById("btnDownloadPlanTemplate")?.addEventListener("click", () => {
    downloadPlanTemplate(state.currentScenario, getActiveData());
  });

  // Печать PDF
  document.getElementById("btnPrintPdf")?.addEventListener("click", () => {
    const data = getActiveData();
    const calc = calculateProgram(data);
    const root = document.getElementById("printReportRoot")!;
    root.innerHTML = buildPrintReportHtml(state.currentScenario, data, calc);
    document.body.classList.add("report-mode");
    window.print();
    document.body.classList.remove("report-mode");
  });

  // Сохранить сценарий
  document.getElementById("btnSaveScenario")?.addEventListener("click", async () => {
    await storageService.saveState(state);
    modalSystem.alert("Сохранено", "Изменения успешно зафиксированы в хранилище.");
  });

  // Изменение ячейки в таблице плана
  document.getElementById("planTable")?.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains("plan-val")) {
      const prodId = target.getAttribute("data-prod")!;
      const monthIdx = parseInt(target.getAttribute("data-month")!);
      const data = getActiveData();
      data.plan[prodId][monthIdx] = parseNum(target.value);
      renderAll();
    }
  });
}

window.addEventListener("DOMContentLoaded", init);