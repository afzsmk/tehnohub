// src/main.ts
import html2canvas from 'html2canvas';
import { AppState, ScenarioData } from './types';
import { calculateProgram } from './core/engine';
import { levelLoadPlan } from './core/levelLoading';
import { storageService } from './services/storage/storageService';
import { exportToExcel, downloadPlanTemplate } from './services/excelService';
import { buildPrintReportHtml } from './services/reportService';
import { modalSystem } from './ui/modal';
import { renderCharts } from './ui/charts';
import { renderPlanTable, attachPlanPasteHandler } from './ui/tables/planTable';
import { renderProfessionsTable, renderProductsTable } from './ui/tables/dictionariesTable';
import { renderShiftScheduleTable, renderResultsTable } from './ui/tables/resultsTable';
import { renderExecutiveSummary, renderSmartAdvisor, renderDynamicGuides } from './ui/advisor';
import { setupNormingTab, openNormingFor } from './ui/normingTab';

let state: AppState;

function getActiveData(): ScenarioData {
  return state.scenarios[state.currentScenario];
}

async function init() {
  modalSystem.init();
  state = await storageService.loadState();
  renderScenarioSelector();
  setupTabs();
  attachGlobalEvents();
  
  const data = getActiveData();
  attachPlanPasteHandler(data, () => {
    storageService.saveState(state);
    renderAll();
  });

  setupNormingTab(data, (prodId, profId, norm, entry) => {
    const p = data.products.find(x => x.id === prodId);
    if (p) {
      p.norms[profId] = norm;
      if (!data.normConfigs) data.normConfigs = {};
      data.normConfigs[`${prodId}___${profId}`] = entry;
      storageService.saveState(state);
      renderAll();
      modalSystem.alert("Успешно", `Норма ${norm} н-ч перенесена в матрицу.`);
    }
  });

  renderAll();
}

function renderAll() {
  const data = getActiveData();
  const calc = calculateProgram(data);

  // Отрисовка всех модулей
  renderExecutiveSummary(calc, data);
  renderSmartAdvisor(calc, data, (headcount) => {
    const res = levelLoadPlan(data, headcount);
    data.plan = res.updatedPlan;
    storageService.saveState(state);
    renderAll();
    modalSystem.alert("План выровнен", `Успешно перераспределено под ${headcount} чел.`);
  });
  renderDynamicGuides(calc, data);

  renderPlanTable(
    data, calc,
    (prodId, mIdx, val) => { data.plan[prodId][mIdx] = val; storageService.saveState(state); renderAll(); },
    (mIdx, name) => { data.months[mIdx] = name; storageService.saveState(state); }
  );

  renderProfessionsTable(data, () => { storageService.saveState(state); renderAll(); });
  renderProductsTable(data, () => { storageService.saveState(state); renderAll(); }, (pId, prId) => openNormingFor(pId, prId));

  renderShiftScheduleTable(calc, data);
  renderResultsTable(calc, data);
  renderCharts(calc, data);
}

function renderScenarioSelector() {
  const selector = document.getElementById("scenarioSelector") as HTMLSelectElement;
  if (!selector) return;
  selector.innerHTML = Object.keys(state.scenarios).map(name => `
    <option value="${name}" ${name === state.currentScenario ? 'selected' : ''}>${name}</option>
  `).join("");

  selector.onchange = () => {
    state.currentScenario = selector.value;
    storageService.saveState(state);
    renderAll();
  };
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

function attachGlobalEvents() {
  // Экспорт Excel
  document.getElementById("btnExportXlsx")?.addEventListener("click", () => {
    const data = getActiveData();
    exportToExcel(state.currentScenario, data, calculateProgram(data));
  });

  // Шаблон плана
  document.getElementById("btnDownloadPlanTemplate")?.addEventListener("click", () => {
    downloadPlanTemplate(state.currentScenario, getActiveData());
  });

  // Печать PDF
  document.getElementById("btnPrintPdf")?.addEventListener("click", () => {
    const data = getActiveData();
    const root = document.getElementById("printReportRoot")!;
    root.innerHTML = buildPrintReportHtml(state.currentScenario, data, calculateProgram(data));
    document.body.classList.add("report-mode");
    window.print();
    document.body.classList.remove("report-mode");
  });

  // Сохранить сценарий вручную
  document.getElementById("btnSaveScenario")?.addEventListener("click", async () => {
    await storageService.saveState(state);
    modalSystem.alert("Сохранено", "Сценарий сохранён в браузере.");
  });

  // Добавить месяц
  document.getElementById("btnAddMonth")?.addEventListener("click", () => {
    const data = getActiveData();
    data.months.push(`М ${data.months.length + 1}`);
    data.products.forEach(p => { (data.plan[p.id] ||= []).push(0); });
    storageService.saveState(state);
    renderAll();
  });

  // Очистить объемы
  document.getElementById("btnClearPlan")?.addEventListener("click", () => {
    modalSystem.confirm("Очистить", "Обнулить весь план выпуска?", () => {
      const data = getActiveData();
      data.products.forEach(p => { data.plan[p.id] = new Array(data.months.length).fill(0); });
      storageService.saveState(state);
      renderAll();
    });
  });
}

window.addEventListener("DOMContentLoaded", init);
