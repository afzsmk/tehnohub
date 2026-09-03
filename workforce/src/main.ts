// src/main.ts
import './styles/main.css';
import html2canvas from 'html2canvas';
import { AppState, ScenarioData } from './types';
import { calculateProgram } from './core/engine';
import { parseNum, calcFNom, calcFEff, calcExtendedFNom } from './core/funds';
import { levelLoadPlan } from './core/levelLoading';
import { storageService } from './services/storage/storageService';
import { exportToExcel, downloadPlanTemplate, parsePlanExcel } from './services/excelService';
import { buildPrintReportHtml } from './services/reportService';
import { PRELOADED_STATE } from './services/storage/defaultState';
import { validateImportedState } from './services/storage/validator';
import { modalSystem } from './ui/modal';
import { renderCharts } from './ui/charts';
import { renderPlanTable, attachPlanPasteHandler } from './ui/tables/planTable';
import { renderProfessionsTable, renderProductsTable } from './ui/tables/dictionariesTable';
import { renderShiftScheduleTable, renderResultsTable } from './ui/tables/resultsTable';
import { renderExecutiveSummary, renderSmartAdvisor, renderDynamicGuides, renderSummaryBullets, renderBrigadeSchedule } from './ui/advisor';
import { setupNormingTab, openNormingFor, renderSavedNormsRegistry } from './ui/normingTab';

let state: AppState;

function getActiveData(): ScenarioData {
  return state.scenarios[state.currentScenario];
}

async function init() {
  modalSystem.init();
  state = await storageService.loadState();
  renderScenarioSelector();
  setupTabs();
  setupCollapsibles();
  attachGlobalEvents();

  const data = getActiveData();
  attachPlanPasteHandler(data, () => {
    storageService.saveState(state);
    renderAll();
  });

  setupNormingTab(
    data,
    (prodId, profId, norm, entry) => {
      const p = data.products.find(x => x.id === prodId);
      if (p) {
        p.norms[profId] = norm;
        if (!data.normConfigs) data.normConfigs = {};
        data.normConfigs[`${prodId}___${profId}`] = entry;
        storageService.saveState(state);
        renderAll();
        modalSystem.alert("Успешно", `Норма ${norm} н-ч перенесена в матрицу норм.`);
      }
    },
    (key) => {
      if (data.normConfigs) {
        delete data.normConfigs[key];
        storageService.saveState(state);
        renderSavedNormsRegistry(data, (k) => { delete data.normConfigs![k]; storageService.saveState(state); renderSavedNormsRegistry(data, () => {}); });
      }
    }
  );

  renderAll();
}

function renderAll() {
  const data = getActiveData();
  const calc = calculateProgram(data);

  updateLevelToggleButton();
  renderExecutiveSummary(calc, data);
  renderKPIs(calc, data);
  renderSummaryBullets(calc, data);
  renderBrigadeSchedule(calc, data, (newShift) => {
    document.getElementById("inputExtendedShiftHours") && ((document.getElementById("inputExtendedShiftHours") as HTMLInputElement).value = String(newShift));
    data.settings.extendedShiftHours = newShift;
    data.settings.fNomExtended = calcExtendedFNom(data.settings.fNom, newShift, data.settings.shiftHoursStandard);
    data.settings.fEffExtended = calcFEff(data.settings.fNomExtended, data.settings.reserveOffPercent);
    storageService.saveState(state);
    renderAll();
  });

  renderSmartAdvisor(calc, data, (headcount) => {
    executeLevelLoading(headcount);
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
  renderDictionariesInputs();
}

function renderKPIs(calc: any, data: ScenarioData) {
  const totalHours = calc.totalHoursByMonth.reduce((a: number, b: number) => a + b, 0);
  const peakStaff = Math.max(...calc.grandTotalStaff);
  const avgStaff = (calc.grandTotalStaff.reduce((a: number, b: number) => a + b, 0) / calc.grandTotalStaff.length);
  const volatility = avgStaff > 0 ? (peakStaff / avgStaff) : 1;

  document.getElementById("kpiTotalProducts")!.textContent = `${data.products.length} поз.`;
  document.getElementById("kpiTotalHours")!.textContent = `${Math.round(totalHours).toLocaleString()} н-ч`;
  document.getElementById("kpiAvgStaff")!.textContent = `${avgStaff.toFixed(1)} чел.`;
  document.getElementById("kpiVolatility")!.textContent = `×${volatility.toFixed(2)}`;
}

function renderDictionariesInputs() {
  const data = getActiveData();
  const s = data.settings;

  const setVal = (id: string, val: any) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el) el.value = String(val ?? '');
  };

  setVal("inputBrigadesCount", s.brigadesCount);
  setVal("inputBrigadeSize", s.brigadeSize);
  setVal("inputMaxOvertime", s.maxOvertimePercent);
  setVal("inputAuxOtk", s.auxOtkPercent);
  setVal("inputAuxSetup", s.auxSetupPercent);
  setVal("inputAuxFixed", s.auxFixedPosts);
  setVal("inputWorkDays", s.workDaysPerMonth);
  setVal("inputShiftHours", s.shiftHoursStandard);
  setVal("inputExtendedShiftHours", s.extendedShiftHours);
  setVal("inputKVn", s.kVn);
  setVal("inputReserveOff", s.reserveOffPercent);
  setVal("inputFNom", s.fNom);
  setVal("inputFEff", s.fEff);
  setVal("inputFNomExtended", s.fNomExtended);
  setVal("inputFEffExtended", s.fEffExtended);
  setVal("inputCompanyName", s.companyName || 'ООО "ЗСМК"');

  const bCount = parseInt(String(s.brigadesCount)) || 3;
  const bSize = parseInt(String(s.brigadeSize)) || 6;
  const hEl = document.getElementById("calcUniversalHeadcount");
  if (hEl) hEl.textContent = `${bCount * bSize} чел. (${bCount} бриг. по ${bSize} чел.)`;

  const prev1 = document.getElementById("previewCap1");
  const prev2 = document.getElementById("previewCap2");
  const prev3 = document.getElementById("previewCap3");
  if (prev1) prev1.textContent = `до ${s.shiftHoursStandard}ч/сутки`;
  if (prev2) prev2.textContent = `${s.shiftHoursStandard}–${s.extendedShiftHours}ч/сутки`;
  if (prev3) prev3.textContent = `свыше ${s.extendedShiftHours}ч/сутки`;

  const previewEff = document.getElementById("fEffWithKvnPreview");
  if (previewEff) previewEff.textContent = `${((s.fEff || 144) * (s.kVn || 1.05)).toFixed(1)} н-ч`;

  const ratioEl = document.getElementById("extendedFundRatioPreview");
  if (ratioEl) ratioEl.textContent = `×${((s.fEffExtended || 216) / (s.fEff || 144)).toFixed(2)}`;
}

function updateLevelToggleButton() {
  const btn = document.getElementById("btnLevelToggle");
  if (!btn) return;
  const data = getActiveData();
  if (data._planSnapshot) {
    btn.className = "btn btn-warning btn-sm";
    btn.innerHTML = `<svg class="icon"><use href="#icon-refresh"></use></svg> Откатить к исходному плану`;
  } else {
    btn.className = "btn btn-level btn-sm";
    btn.innerHTML = `<svg class="icon"><use href="#icon-sliders"></use></svg> Выровнять план под штат`;
  }
}

function executeLevelLoading(targetHeadcount: number) {
  const data = getActiveData();
  if (!data._planSnapshot) {
    data._planSnapshot = JSON.parse(JSON.stringify(data.plan));
  }
  const res = levelLoadPlan(data, targetHeadcount);
  data.plan = res.updatedPlan;
  storageService.saveState(state);
  renderAll();
  modalSystem.alert("План выровнен", `План перераспределен под целевой штат ${targetHeadcount} чел. Перенесено ${Math.round(res.totalShiftedHours)} н-ч.`);
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
      if (tab === "tab-analytics") renderAll();
    });
  });
}

function setupCollapsibles() {
  const collapsibles = [
    { btn: "toggleGuideTab1", content: "contentGuideTab1", chevron: "chevronGuideTab1" },
    { btn: "toggleGuideTab2", content: "contentGuideTab2", chevron: "chevronGuideTab2" },
    { btn: "toggleGuideTab3", content: "contentGuideTab3", chevron: "chevronGuideTab3" },
    { btn: "toggleSavedNormsRegistry", content: "contentSavedNorms", chevron: "chevronSavedNorms" }
  ];

  collapsibles.forEach(c => {
    document.getElementById(c.btn)?.addEventListener("click", () => {
      document.getElementById(c.content)?.classList.toggle("expanded");
      document.getElementById(c.chevron)?.classList.toggle("rotated");
    });
  });
}

function attachGlobalEvents() {
  // Выравнивание / Откат плана
  document.getElementById("btnLevelToggle")?.addEventListener("click", () => {
    const data = getActiveData();
    if (data._planSnapshot) {
      modalSystem.confirm("Откат плана", "Вернуть производственный план к исходным объёмам до выравнивания?", () => {
        data.plan = JSON.parse(JSON.stringify(data._planSnapshot));
        delete data._planSnapshot;
        storageService.saveState(state);
        renderAll();
      });
    } else {
      const calc = calculateProgram(data);
      const avg = Math.round(calc.grandTotalStaff.reduce((a, b) => a + b, 0) / calc.grandTotalStaff.length);
      modalSystem.prompt("Выравнивание плана", "Укажите целевую численность персонала (чел.):", String(avg), (val) => {
        const target = parseInt(val);
        if (target > 0) executeLevelLoading(target);
      });
    }
  });

  // Управление сценариями: Сохранить
  document.getElementById("btnSaveScenario")?.addEventListener("click", async () => {
    await storageService.saveState(state);
    modalSystem.alert("Сохранено", `Сценарий «${state.currentScenario}» сохранён.`);
  });

  // Новый сценарий
  document.getElementById("btnNewScenario")?.addEventListener("click", () => {
    modalSystem.prompt("Новый сценарий", "Введите имя копии сценария:", `План ${new Date().toLocaleDateString()}`, (newName) => {
      if (newName?.trim()) {
        const clean = newName.trim();
        state.scenarios[clean] = JSON.parse(JSON.stringify(getActiveData()));
        state.currentScenario = clean;
        storageService.saveState(state);
        renderScenarioSelector();
        renderAll();
      }
    });
  });

  // Удалить сценарий
  document.getElementById("btnDeleteScenario")?.addEventListener("click", () => {
    const keys = Object.keys(state.scenarios);
    if (keys.length <= 1) {
      modalSystem.alert("Внимание", "Нельзя удалить единственный существующий сценарий.");
      return;
    }
    modalSystem.confirm("Удаление", `Удалить сценарий «${state.currentScenario}»?`, async () => {
      const toDel = state.currentScenario;
      delete state.scenarios[toDel];
      state.currentScenario = Object.keys(state.scenarios)[0];
      await storageService.deleteScenario(toDel);
      await storageService.saveState(state);
      renderScenarioSelector();
      renderAll();
    });
  });

  // Сброс к эталонам
  document.getElementById("btnResetData")?.addEventListener("click", () => {
    modalSystem.confirm("Сброс данных", "Сбросить сценарии к эталонным планам завода?", () => {
      state = JSON.parse(JSON.stringify(PRELOADED_STATE));
      storageService.saveState(state);
      renderScenarioSelector();
      renderAll();
    });
  });

  // Экспорт / Импорт JSON
  document.getElementById("btnExportJson")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `План_производства_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
  });

  document.getElementById("btnImportJson")?.addEventListener("click", () => {
    document.getElementById("fileJsonInput")?.click();
  });

  document.getElementById("fileJsonInput")?.addEventListener("change", (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        const errs = validateImportedState(imported);
        if (errs.length === 0) {
          state = imported;
          storageService.saveState(state);
          renderScenarioSelector();
          renderAll();
          modalSystem.alert("Успешно", "Сценарии загружены из файла.");
        } else {
          modalSystem.alert("Ошибка файла", errs.join("<br>"));
        }
      } catch (err: any) {
        modalSystem.alert("Ошибка", "Не удалось прочитать JSON: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // Экспорт Excel
  document.getElementById("btnExportXlsx")?.addEventListener("click", () => {
    const data = getActiveData();
    exportToExcel(state.currentScenario, data, calculateProgram(data));
  });

  // Шаблон Excel и импорт плана
  document.getElementById("btnDownloadPlanTemplate")?.addEventListener("click", () => {
    downloadPlanTemplate(state.currentScenario, getActiveData());
  });

  document.getElementById("btnUploadPlanTemplate")?.addEventListener("click", () => {
    document.getElementById("planExcelFileInput")?.click();
  });

  document.getElementById("planExcelFileInput")?.addEventListener("change", async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await parsePlanExcel(file, getActiveData());
      storageService.saveState(state);
      renderAll();
      modalSystem.alert("Импорт выполнен", `Обновлено ячеек: ${res.updatedCells}. Сопоставлено изделий: ${res.matchedRows}.`);
    } catch (err: any) {
      modalSystem.alert("Ошибка", err.message);
    }
    e.target.value = "";
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

  // Снимок PNG
  document.getElementById("btnDownloadAnalyticsImage")?.addEventListener("click", () => {
    const area = document.getElementById("analyticsCaptureArea");
    if (!area) return;
    html2canvas(area, { scale: 2 }).then(canvas => {
      const link = document.createElement("a");
      link.download = `Аналитика_${state.currentScenario}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  });

  // Экспорт CSV
  document.getElementById("btnExportCSV")?.addEventListener("click", () => {
    const data = getActiveData();
    const calc = calculateProgram(data);
    let csv = "\uFEFF\"Показатель\";" + data.months.map(m => `"${m}"`).join(";") + ";\"Итого\"\n";
    data.professions.forEach(prof => {
      csv += `"${prof.name} (н-ч)";` + calc.hoursByProf[prof.id].map(h => Math.round(h)).join(";") + `;${Math.round(calc.hoursByProf[prof.id].reduce((a,b)=>a+b,0))}\n`;
    });
    csv += `"ИТОГО ОБЩИЙ ШТАТ (чел)";` + calc.grandTotalStaff.join(";") + `;${Math.max(...calc.grandTotalStaff)}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Ведомость_персонала_${state.currentScenario}.csv`;
    link.click();
  });

  // Добавить месяц / Очистить
  document.getElementById("btnAddMonth")?.addEventListener("click", () => {
    const data = getActiveData();
    data.months.push(`М ${data.months.length + 1}`);
    data.products.forEach(p => { (data.plan[p.id] ||= []).push(0); });
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById("btnClearPlan")?.addEventListener("click", () => {
    modalSystem.confirm("Очистить", "Обнулить объёмы выпуска по всем месяцам?", () => {
      const data = getActiveData();
      data.products.forEach(p => { data.plan[p.id] = new Array(data.months.length).fill(0); });
      storageService.saveState(state);
      renderAll();
    });
  });

  // Добавить изделие
  document.getElementById("btnAddProduct")?.addEventListener("click", () => {
    modalSystem.prompt("Новое изделие", "Введите наименование:", "Новая позиция", (name) => {
      if (name?.trim()) {
        const data = getActiveData();
        const id = "pr" + Date.now();
        const norms: Record<string, number> = {};
        data.professions.forEach(pr => { norms[pr.id] = 0; });
        data.products.push({ id, name: name.trim(), unit: "м²", scrap: 2, norms });
        data.plan[id] = new Array(data.months.length).fill(0);
        storageService.saveState(state);
        renderAll();
      }
    });
  });

  // Добавить участок
  document.getElementById("btnAddProfession")?.addEventListener("click", () => {
    modalSystem.prompt("Новый участок", "Наименование технологического участка:", "Новый участок", (name) => {
      if (name?.trim()) {
        const data = getActiveData();
        const id = "p" + Date.now();
        data.professions.push({ id, name: name.trim(), pool: "universal", machines: 1, crew: 1 });
        data.products.forEach(p => { p.norms[id] = 0; });
        storageService.saveState(state);
        renderAll();
      }
    });
  });

  // Кнопки пересчёта фондов ↺
  document.getElementById("btnRecalcFNom")?.addEventListener("click", () => {
    const data = getActiveData();
    data.settings.fNom = calcFNom(data.settings.workDaysPerMonth, data.settings.shiftHoursStandard);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById("btnRecalcFEff")?.addEventListener("click", () => {
    const data = getActiveData();
    data.settings.fEff = calcFEff(data.settings.fNom, data.settings.reserveOffPercent);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById("btnRecalcFNomExtended")?.addEventListener("click", () => {
    const data = getActiveData();
    data.settings.fNomExtended = calcExtendedFNom(data.settings.fNom, data.settings.extendedShiftHours, data.settings.shiftHoursStandard);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById("btnRecalcFEffExtended")?.addEventListener("click", () => {
    const data = getActiveData();
    data.settings.fEffExtended = calcFEff(data.settings.fNomExtended, data.settings.reserveOffPercent);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById("btnSyncAllFunds")?.addEventListener("click", () => {
    const data = getActiveData();
    const s = data.settings;
    s.fNom = calcFNom(s.workDaysPerMonth, s.shiftHoursStandard);
    s.fEff = calcFEff(s.fNom, s.reserveOffPercent);
    s.fNomExtended = calcExtendedFNom(s.fNom, s.extendedShiftHours, s.shiftHoursStandard);
    s.fEffExtended = calcFEff(s.fNomExtended, s.reserveOffPercent);
    storageService.saveState(state);
    renderAll();
    modalSystem.alert("Синхронизировано", "Все фонды пересчитаны от текущего календаря.");
  });

  document.getElementById("btnResetCalendarDefaults")?.addEventListener("click", () => {
    const data = getActiveData();
    data.settings.workDaysPerMonth = 21;
    data.settings.shiftHoursStandard = 8;
    data.settings.extendedShiftHours = 12;
    storageService.saveState(state);
    renderAll();
  });

  // Привязка инпутов настроек
  const bindInput = (id: string, prop: keyof typeof data.settings, isNum: boolean = true) => {
    const data = getActiveData();
    document.getElementById(id)?.addEventListener("input", (e: any) => {
      (data.settings as any)[prop] = isNum ? parseNum(e.target.value) : e.target.value;
      storageService.saveState(state);
      renderAll();
    });
  };

  bindInput("inputBrigadesCount", "brigadesCount");
  bindInput("inputBrigadeSize", "brigadeSize");
  bindInput("inputMaxOvertime", "maxOvertimePercent");
  bindInput("inputAuxOtk", "auxOtkPercent");
  bindInput("inputAuxSetup", "auxSetupPercent");
  bindInput("inputAuxFixed", "auxFixedPosts");
  bindInput("inputWorkDays", "workDaysPerMonth");
  bindInput("inputShiftHours", "shiftHoursStandard");
  bindInput("inputExtendedShiftHours", "extendedShiftHours");
  bindInput("inputKVn", "kVn");
  bindInput("inputReserveOff", "reserveOffPercent");
  bindInput("inputCompanyName", "companyName", false);
}

window.addEventListener("DOMContentLoaded", init);
