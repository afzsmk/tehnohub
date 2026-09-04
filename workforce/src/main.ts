// src/main.ts
import './styles/main.css';
import html2canvas from 'html2canvas';
import { AppState, ScenarioData, Settings } from './types';
import { calculateProgram } from './core/engine';
import { parseNum, calcFNom, calcFEff, calcExtendedFNom } from './core/funds';
import { levelLoadPlan } from './core/levelLoading';
import { storageService } from './services/storage/storageService';
import { authService } from './services/storage/authService';
import { exportToExcel, downloadPlanTemplate, parsePlanExcel } from './services/excelService';
import { buildPrintReportHtml } from './services/reportService';
import { PRELOADED_STATE } from './services/storage/defaultState';
import { validateImportedState } from './services/storage/validator';
import { modalSystem } from './ui/modal';
import { renderCharts } from './ui/charts';
import { renderPlanTable, attachPlanPasteHandler } from './ui/tables/planTable';
import { renderProfessionsTable, renderProductsTable } from './ui/tables/dictionariesTable';
import { renderShiftScheduleTable, renderResultsTable } from './ui/tables/resultsTable';
import {
  renderExecutiveSummary,
  renderSmartAdvisor,
  renderDynamicGuides,
  renderSummaryBullets,
  renderBrigadeSchedule
} from './ui/advisor';
import {
  setupNormingTab,
  openNormingFor,
  renderSavedNormsRegistry,
  refreshNormingDropdowns
} from './ui/normingTab';

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
  setupAuthAndStorageToggle();
  attachGlobalEvents();

  const data = getActiveData();
  attachPlanPasteHandler(data, () => {
    storageService.saveState(state);
    renderAll();
  });

  setupNormingTab(
    () => getActiveData(),
    () => state,
    () => renderAll()
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
  renderBrigadeSchedule(calc, data, (newShift: number) => {
    const conflicts: string[] = [];
    data.months.forEach((m, idx) => {
      const sched = calc.universalSchedules[idx];
      if (sched.isExtendedShift && sched.trueNeededShift > newShift) {
        conflicts.push(`${m} (нужно ${sched.trueNeededShift}ч)`);
      }
    });

    const applyFn = () => {
      const extInput = document.getElementById('inputExtendedShiftHours') as HTMLInputElement | null;
      if (extInput) extInput.value = String(newShift);
      data.settings.extendedShiftHours = newShift;
      data.settings.fNomExtended = calcExtendedFNom(data.settings.fNom, newShift, data.settings.shiftHoursStandard);
      data.settings.fEffExtended = calcFEff(data.settings.fNomExtended, data.settings.reserveOffPercent);
      storageService.saveState(state);
      renderAll();
    };

    if (conflicts.length > 0) {
      modalSystem.confirm(
        'Проверьте другие периоды',
        `Вы применяете смену <strong>${newShift}ч</strong>. Но в других месяцах усиленного режима требуется больше: ${conflicts.join(', ')}. Если применить ${newShift}ч как общий предел — эти месяцы окажутся недогружены. Применить всё равно?`,
        applyFn
      );
    } else {
      applyFn();
    }
  });

  renderSmartAdvisor(calc, data, (headcount: number) => {
    executeLevelLoading(headcount);
  });

  renderDynamicGuides(calc, data);
  renderSavedNormsRegistry(data, (key) => {
    if (data.normConfigs) {
      delete data.normConfigs[key];
      storageService.saveState(state);
      renderAll();
    }
  });

  renderPlanTable(
    data,
    calc,
    (prodId, mIdx, val) => {
      if (!data.plan[prodId]) data.plan[prodId] = [];
      data.plan[prodId][mIdx] = val;
      storageService.saveState(state);
      const freshCalc = calculateProgram(data);
      renderKPIs(freshCalc, data);
      renderExecutiveSummary(freshCalc, data);
      renderDynamicGuides(freshCalc, data);
      const tfootTds = document.querySelectorAll('#planTableFooter td');
      if (tfootTds && tfootTds[mIdx + 1]) {
        tfootTds[mIdx + 1].textContent = Math.round(freshCalc.totalHoursByMonth[mIdx]).toLocaleString();
      }
      const grandTotalHours = freshCalc.totalHoursByMonth.reduce((a, b) => a + b, 0);
      const lastFooterTd = document.querySelector('#planTableFooter td:last-child');
      if (lastFooterTd) lastFooterTd.textContent = `${Math.round(grandTotalHours).toLocaleString()} н-ч`;
    },
    (mIdx, name) => {
      data.months[mIdx] = name;
      storageService.saveState(state);
    },
    (fromIdx, toIdx) => {
      [data.months[fromIdx], data.months[toIdx]] = [data.months[toIdx], data.months[fromIdx]];
      data.products.forEach(p => {
        if (data.plan[p.id]) {
          [data.plan[p.id][fromIdx], data.plan[p.id][toIdx]] = [data.plan[p.id][toIdx], data.plan[p.id][fromIdx]];
        }
      });
      storageService.saveState(state);
      renderAll();
    },
    (idx) => {
      data.months.splice(idx, 1);
      data.products.forEach(p => {
        if (data.plan[p.id]) data.plan[p.id].splice(idx, 1);
      });
      storageService.saveState(state);
      renderAll();
    }
  );

  renderProfessionsTable(
    data,
    () => { storageService.saveState(state); renderAll(); },
    () => {
      storageService.saveState(state);
      const freshCalc = calculateProgram(data);
      renderKPIs(freshCalc, data);
      renderExecutiveSummary(freshCalc, data);
    }
  );

  renderProductsTable(
    data,
    () => { storageService.saveState(state); renderAll(); },
    () => {
      storageService.saveState(state);
      const freshCalc = calculateProgram(data);
      renderKPIs(freshCalc, data);
      renderExecutiveSummary(freshCalc, data);
    },
    (pId, prId) => openNormingFor(pId, prId, data)
  );

  renderShiftScheduleTable(calc, data);
  renderResultsTable(calc, data);
  renderCharts(calc, data);
  renderDictionariesInputs();
}

function renderKPIs(calc: any, data: ScenarioData) {
  const totalHours = calc.totalHoursByMonth.reduce((a: number, b: number) => a + b, 0);
  const peakStaff = Math.max(...calc.grandTotalStaff);
  const staffSum = calc.grandTotalStaff.reduce((a: number, b: number) => a + b, 0);
  const avgStaff = calc.grandTotalStaff.length > 0 ? (staffSum / calc.grandTotalStaff.length) : 0;
  const volatility = avgStaff > 0 ? (peakStaff / avgStaff) : 1;

  const pEl = document.getElementById('kpiTotalProducts');
  const hEl = document.getElementById('kpiTotalHours');
  const aEl = document.getElementById('kpiAvgStaff');
  const vEl = document.getElementById('kpiVolatility');

  if (pEl) pEl.textContent = `${data.products.length} поз.`;
  if (hEl) hEl.textContent = `${Math.round(totalHours).toLocaleString()} н-ч`;
  if (aEl) aEl.textContent = `${avgStaff.toFixed(1)} чел.`;
  if (vEl) vEl.textContent = `×${volatility.toFixed(2)}`;
}

function renderDictionariesInputs() {
  const data = getActiveData();
  const s = data.settings;

  const setVal = (id: string, val: any) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el && document.activeElement !== el) {
      el.value = String(val ?? '');
    }
  };

  setVal('inputBrigadesCount', s.brigadesCount);
  setVal('inputBrigadeSize', s.brigadeSize);
  setVal('inputMaxOvertime', s.maxOvertimePercent);
  setVal('inputAuxOtk', s.auxOtkPercent);
  setVal('inputAuxSetup', s.auxSetupPercent);
  setVal('inputAuxFixed', s.auxFixedPosts);
  setVal('inputWorkDays', s.workDaysPerMonth);
  setVal('inputShiftHours', s.shiftHoursStandard);
  setVal('inputExtendedShiftHours', s.extendedShiftHours);
  setVal('inputKVn', s.kVn);
  setVal('inputReserveOff', s.reserveOffPercent);
  setVal('inputFNom', s.fNom);
  setVal('inputFEff', s.fEff);
  setVal('inputFNomExtended', s.fNomExtended);
  setVal('inputFEffExtended', s.fEffExtended);
  setVal('inputCompanyName', s.companyName || 'ООО "ЗСМК"');

  const bCount = parseInt(String(s.brigadesCount)) || 3;
  const bSize = parseInt(String(s.brigadeSize)) || 6;
  const hEl = document.getElementById('calcUniversalHeadcount');
  if (hEl) hEl.textContent = `${bCount * bSize} чел. (${bCount} бриг. по ${bSize} чел.)`;

  const prev1 = document.getElementById('previewCap1');
  const prev2 = document.getElementById('previewCap2');
  const prev3 = document.getElementById('previewCap3');
  if (prev1) prev1.textContent = `до ${s.shiftHoursStandard}ч/сутки`;
  if (prev2) prev2.textContent = `${s.shiftHoursStandard}–${s.extendedShiftHours}ч/сутки`;
  if (prev3) prev3.textContent = `свыше ${s.extendedShiftHours}ч/сутки`;

  const previewEff = document.getElementById('fEffWithKvnPreview');
  if (previewEff) previewEff.textContent = `${((s.fEff || 144) * (s.kVn || 1.05)).toFixed(1)} н-ч`;

  const ratioEl = document.getElementById('extendedFundRatioPreview');
  if (ratioEl) ratioEl.textContent = `×${((s.fEffExtended || 216) / (s.fEff || 144)).toFixed(2)}`;
}

function updateLevelToggleButton() {
  const btn = document.getElementById('btnLevelToggle');
  if (!btn) return;
  const data = getActiveData();
  if (data._planSnapshot) {
    btn.className = 'btn btn-warning btn-sm';
    btn.innerHTML = `<svg class="icon"><use href="#icon-refresh"></use></svg> Откатить к исходному плану`;
  } else {
    btn.className = 'btn btn-level btn-sm';
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

  const freshCalc = calculateProgram(data);
  const stillBottlenecked: string[] = [];
  freshCalc.dedicatedProfs.forEach(prof => {
    freshCalc.profMachineZones[prof.id].forEach((zone, mIdx) => {
      if (zone.statusZone === 'red') stillBottlenecked.push(`${prof.name} (${data.months[mIdx]})`);
    });
  });

  let warningHtml = '';
  if (stillBottlenecked.length > 0) {
    warningHtml = `<br><br><div style="background:var(--danger-light); border:1px solid #fca5a5; border-radius:6px; padding:8px 10px; color:var(--danger); font-size:12.5px;">
      <strong>⚠ Внимание:</strong> выравнивание изменило только помесячное распределение объёмов — оно не увеличивает пропускную способность оборудования. Следующие посты остаются физически перегружены: <strong>${stillBottlenecked.join(', ')}</strong>. Для их разгрузки нужен доп. станок или снижение выпуска.
    </div>`;
  }

  modalSystem.alert('План выровнен', `
    Производственная программа перераспределена под целевой штат <strong>${targetHeadcount} чел.</strong><br><br>
    • Допустимая ёмкость месяца: <strong>${Math.round(res.maxMonthlyHours).toLocaleString()} н-ч</strong><br>
    • Перераспределено объёмов: <strong>${Math.round(res.totalShiftedHours).toLocaleString()} н-ч</strong><br><br>
    Общие пики сглажены. Кнопка переключена на «Откатить к исходному плану».
    ${warningHtml}
  `);
}

function renderScenarioSelector() {
  const selector = document.getElementById('scenarioSelector') as HTMLSelectElement | null;
  if (!selector) return;
  selector.innerHTML = Object.keys(state.scenarios).map(name => `
    <option value="${name}" ${name === state.currentScenario ? 'selected' : ''}>${name}</option>
  `).join('');

  selector.onchange = () => {
    state.currentScenario = selector.value;
    storageService.saveState(state);
    refreshNormingDropdowns(getActiveData());
    renderAll();
  };
}

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      if (tab) {
        document.getElementById(tab)?.classList.add('active');
        if (tab === 'tab-analytics' || tab === 'tab-norming') {
          renderAll();
          if (tab === 'tab-norming') refreshNormingDropdowns(getActiveData());
        }
      }
    });
  });
}

function setupCollapsibles() {
  const collapsibles = [
    { btn: 'toggleGuideTab1', content: 'contentGuideTab1', chevron: 'chevronGuideTab1' },
    { btn: 'toggleGuideTab2', content: 'contentGuideTab2', chevron: 'chevronGuideTab2' },
    { btn: 'toggleGuideTab3', content: 'contentGuideTab3', chevron: 'chevronGuideTab3' },
    { btn: 'toggleMethodologyBtn', content: 'methodologyContent', chevron: 'methodChevron' },
    { btn: 'toggleSavedNormsRegistry', content: 'contentSavedNorms', chevron: 'chevronSavedNorms' }
  ];

  collapsibles.forEach(c => {
    document.getElementById(c.btn)?.addEventListener('click', () => {
      document.getElementById(c.content)?.classList.toggle('expanded');
      document.getElementById(c.chevron)?.classList.toggle('rotated');
    });
  });
}

// УПРАВЛЕНИЕ АВТОРИЗАЦИЕЙ И СЛАЙДЕРОМ ХРАНИЛИЩА
function setupAuthAndStorageToggle() {
  const guestWrap = document.getElementById('guestAuthWrap');
  const userWrap = document.getElementById('userAuthWrap');
  const userEmailBadge = document.getElementById('userEmailBadge');
  const btnModeLocal = document.getElementById('btnModeLocal');
  const btnModeCloud = document.getElementById('btnModeCloud');
  const btnPublish = document.getElementById('btnPublishToCloud');

  const updateUI = (user: any) => {
    const isCloud = storageService.getMode() === 'cloud';
    if (user) {
      if (guestWrap) guestWrap.style.display = 'none';
      if (userWrap) userWrap.style.display = 'inline-flex';
      if (userEmailBadge) userEmailBadge.textContent = `👤 ${user.email}`;

      btnModeLocal?.classList.toggle('active', !isCloud);
      btnModeCloud?.classList.toggle('active-cloud', isCloud);
      btnModeCloud?.classList.toggle('active', isCloud);

      if (btnPublish) btnPublish.style.display = !isCloud ? 'inline-flex' : 'none';
    } else {
      if (guestWrap) guestWrap.style.display = 'inline-flex';
      if (userWrap) userWrap.style.display = 'none';
      if (btnPublish) btnPublish.style.display = 'none';
    }
  };

  // МГНОВЕННОЕ ПЕРЕКЛЮЧЕНИЕ НА БРАУЗЕР
  btnModeLocal?.addEventListener('click', async () => {
    storageService.setMode('local');
    state = await storageService.loadState();
    renderScenarioSelector();
    renderAll();
    const user = await authService.getUser();
    updateUI(user);
    modalSystem.alert('Режим хранилища', 'Включён режим <strong>Память браузера</strong> (Локальная песочница).');
  });

  // МГНОВЕННОЕ ПЕРЕКЛЮЧЕНИЕ НА ОБЛАКО
  btnModeCloud?.addEventListener('click', async () => {
    storageService.setMode('cloud');
    state = await storageService.loadState();
    renderScenarioSelector();
    renderAll();
    const user = await authService.getUser();
    updateUI(user);
    modalSystem.alert('Режим хранилища', 'Включено <strong>Единое облако ЗСМК</strong>. Данные синхронизируются с базой завода.');
  });

  document.getElementById('btnOpenLoginModal')?.addEventListener('click', () => {
    openAuthModal();
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await authService.signOut();
    storageService.setMode('local');
    state = await storageService.loadState();
    renderScenarioSelector();
    renderAll();
    updateUI(null);
    modalSystem.alert('Выход', 'Вы вышли из аккаунта. Приложение вернулось в режим локальной песочницы.');
  });

  btnPublish?.addEventListener('click', () => {
    const data = getActiveData();
    modalSystem.confirm(
      'Публикация в Облако',
      `Опубликовать сценарий <strong>«${state.currentScenario}»</strong> в единую базу завода ЗСМК? Он станет доступен всем сотрудникам.`,
      async () => {
        try {
          await storageService.publishToCloud(state.currentScenario, data);
          modalSystem.alert('Опубликовано', `Сценарий «${state.currentScenario}» успешно отправлен в облачную базу ЗСМК!`);
        } catch (err: any) {
          modalSystem.alert('Ошибка', 'Не удалось опубликовать: ' + err.message);
        }
      }
    );
  });

  authService.onAuthStateChange((user) => {
    updateUI(user);
  });

  authService.getUser().then(user => updateUI(user));
}

// ДИАЛОГ ВХОДА ПЛАНОВИКА
function openAuthModal() {
  const bodyHtml = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <p style="font-size:12.5px; color:var(--text-secondary);">Для записи в единую базу завода и переключения на официальные сценарии введите данные учётной записи:</p>
      <div>
        <label style="font-size:11.5px; font-weight:600; color:var(--text-muted);">EMAIL:</label>
        <input type="email" id="authInputEmail" class="input-control" placeholder="planner@zsmk.ru" style="margin-top:2px;">
      </div>
      <div>
        <label style="font-size:11.5px; font-weight:600; color:var(--text-muted);">ПАРОЛЬ:</label>
        <input type="password" id="authInputPassword" class="input-control" placeholder="••••••••" style="margin-top:2px;">
      </div>
    </div>
  `;

  modalSystem.show(
    '<svg class="icon"><use href="#icon-zap"></use></svg> Авторизация плановика',
    bodyHtml,
    false,
    '',
    [
      { label: 'Отмена', class: 'btn-secondary' },
      {
        label: 'Войти',
        class: 'btn-primary',
        isPrimary: true,
        action: async () => {
          const email = (document.getElementById('authInputEmail') as HTMLInputElement)?.value.trim();
          const pass = (document.getElementById('authInputPassword') as HTMLInputElement)?.value;
          if (!email || !pass) {
            modalSystem.alert('Ошибка', 'Заполните email и пароль.');
            return;
          }
          const res = await authService.signIn(email, pass);
          if (res.error) {
            modalSystem.alert('Ошибка входа', res.error);
          } else {
            storageService.setMode('cloud');
            state = await storageService.loadState();
            renderScenarioSelector();
            renderAll();
            modalSystem.alert('Успешный вход', `Вы вошли как <strong>${res.user?.email}</strong>. Включён режим работы с облаком завода.`);
          }
        }
      }
    ]
  );
}

function attachGlobalEvents() {
  document.getElementById('btnLevelToggle')?.addEventListener('click', () => {
    const data = getActiveData();
    if (data._planSnapshot) {
      modalSystem.confirm('Откат плана', 'Вернуть производственный план к исходным объёмам до выравнивания?', () => {
        data.plan = JSON.parse(JSON.stringify(data._planSnapshot));
        delete data._planSnapshot;
        storageService.saveState(state);
        renderAll();
      });
    } else {
      const calc = calculateProgram(data);
      const staffSum = calc.grandTotalStaff.reduce((a: number, b: number) => a + b, 0);
      const avg = calc.grandTotalStaff.length > 0 ? Math.round(staffSum / calc.grandTotalStaff.length) : 25;
      modalSystem.prompt('Выравнивание плана', 'Укажите целевую численность персонала (чел.):', String(avg), (val) => {
        const target = parseInt(val);
        if (target > 0) executeLevelLoading(target);
      });
    }
  });

  document.getElementById('btnSaveScenario')?.addEventListener('click', async () => {
    try {
      await storageService.saveState(state);
      const modeText = storageService.getMode() === 'cloud' ? 'в облачную базу ЗСМК' : 'в память вашего браузера';
      modalSystem.alert('Сохранено', `Сценарий «${state.currentScenario}» сохранён ${modeText}.`);
    } catch (err: any) {
      modalSystem.alert('Ошибка сохранения', err.message);
    }
  });

  document.getElementById('btnNewScenario')?.addEventListener('click', () => {
    modalSystem.prompt('Новый сценарий', 'Введите имя копии сценария:', `План ${new Date().toLocaleDateString()}`, (newName) => {
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

  document.getElementById('btnDeleteScenario')?.addEventListener('click', () => {
    const keys = Object.keys(state.scenarios);
    if (keys.length <= 1) {
      modalSystem.alert('Внимание', 'Нельзя удалить единственный существующий сценарий.');
      return;
    }
    modalSystem.confirm('Удаление', `Удалить сценарий «${state.currentScenario}»?`, async () => {
      const toDel = state.currentScenario;
      delete state.scenarios[toDel];
      state.currentScenario = Object.keys(state.scenarios)[0];
      try {
        await storageService.deleteScenario(toDel);
        await storageService.saveState(state);
        renderScenarioSelector();
        renderAll();
      } catch (err: any) {
        modalSystem.alert('Ошибка удаления', err.message);
      }
    });
  });

  document.getElementById('btnResetData')?.addEventListener('click', () => {
    modalSystem.confirm('Сброс данных', 'Сбросить сценарии к эталонным планам завода?', () => {
      state = JSON.parse(JSON.stringify(PRELOADED_STATE));
      storageService.saveState(state);
      renderScenarioSelector();
      renderAll();
    });
  });

  document.getElementById('btnExportJson')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `План_производства_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
  });

  document.getElementById('btnImportJson')?.addEventListener('click', () => {
    document.getElementById('fileJsonInput')?.click();
  });

  document.getElementById('fileJsonInput')?.addEventListener('change', (e: any) => {
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
          modalSystem.alert('Успешно', 'Сценарии загружены из файла.');
        } else {
          modalSystem.alert('Ошибка файла', errs.join('<br>'));
        }
      } catch (err: any) {
        modalSystem.alert('Ошибка', 'Не удалось прочитать JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btnExportXlsx')?.addEventListener('click', () => {
    const data = getActiveData();
    exportToExcel(state.currentScenario, data, calculateProgram(data));
  });

  document.getElementById('btnDownloadPlanTemplate')?.addEventListener('click', () => {
    downloadPlanTemplate(state.currentScenario, getActiveData());
  });

  document.getElementById('btnUploadPlanTemplate')?.addEventListener('click', () => {
    document.getElementById('planExcelFileInput')?.click();
  });

  document.getElementById('planExcelFileInput')?.addEventListener('change', async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await parsePlanExcel(file, getActiveData());
      storageService.saveState(state);
      renderAll();
      modalSystem.alert('Импорт выполнен', `Обновлено ячеек: ${res.updatedCells}. Сопоставлено изделий: ${res.matchedRows}.`);
    } catch (err: any) {
      modalSystem.alert('Ошибка', err.message);
    }
    e.target.value = '';
  });

  document.getElementById('btnPrintPdf')?.addEventListener('click', () => {
    const data = getActiveData();
    const root = document.getElementById('printReportRoot')!;
    root.innerHTML = buildPrintReportHtml(state.currentScenario, data, calculateProgram(data));
    document.body.classList.add('report-mode');
    window.print();
    document.body.classList.remove('report-mode');
  });

  document.getElementById('btnDownloadAnalyticsImage')?.addEventListener('click', () => {
    const area = document.getElementById('analyticsCaptureArea');
    if (!area) return;
    html2canvas(area, { scale: 2 }).then(canvas => {
      const link = document.createElement('a');
      link.download = `Аналитика_${state.currentScenario}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    });
  });

  document.getElementById('btnExportCSV')?.addEventListener('click', () => {
    const data = getActiveData();
    const calc = calculateProgram(data);
    let csv = '\uFEFF"Показатель";' + data.months.map(m => `"${m}"`).join(';') + ';"Итого"\n';
    data.professions.forEach(prof => {
      csv += `"${prof.name} (н-ч)";` + calc.hoursByProf[prof.id].map(h => Math.round(h)).join(';') + `;${Math.round(calc.hoursByProf[prof.id].reduce((a,b)=>a+b,0))}\n`;
    });
    csv += '"ИТОГО ОБЩИЙ ШТАТ (чел)";' + calc.grandTotalStaff.join(';') + `;${Math.max(...calc.grandTotalStaff)}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Ведомость_персонала_${state.currentScenario}.csv`;
    link.click();
  });

  document.getElementById('btnAddMonth')?.addEventListener('click', () => {
    const data = getActiveData();
    data.months.push(`М ${data.months.length + 1}`);
    data.products.forEach(p => {
      if (!data.plan[p.id]) data.plan[p.id] = [];
      data.plan[p.id].push(0);
    });
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById('btnClearPlan')?.addEventListener('click', () => {
    modalSystem.confirm('Очистить', 'Обнулить объёмы выпуска по всем месяцам?', () => {
      const data = getActiveData();
      data.products.forEach(p => { data.plan[p.id] = new Array(data.months.length).fill(0); });
      storageService.saveState(state);
      renderAll();
    });
  });

  document.getElementById('btnAddProduct')?.addEventListener('click', () => {
    modalSystem.prompt('Новое изделие', 'Введите наименование:', 'Новая позиция', (name) => {
      if (name?.trim()) {
        const data = getActiveData();
        const id = 'pr' + Date.now();
        const norms: Record<string, number> = {};
        data.professions.forEach(pr => { norms[pr.id] = 0; });
        data.products.push({ id, name: name.trim(), unit: 'м²', scrap: 2, norms });
        data.plan[id] = new Array(data.months.length).fill(0);
        storageService.saveState(state);
        renderAll();
      }
    });
  });

  document.getElementById('btnAddProfession')?.addEventListener('click', () => {
    modalSystem.prompt('Новый участок', 'Наименование технологического участка:', 'Новый участок', (name) => {
      if (name?.trim()) {
        const data = getActiveData();
        const id = 'p' + Date.now();
        data.professions.push({ id, name: name.trim(), pool: 'universal', machines: 1, crew: 1 });
        data.products.forEach(p => { p.norms[id] = 0; });
        storageService.saveState(state);
        renderAll();
      }
    });
  });

  document.getElementById('btnRecalcFNom')?.addEventListener('click', () => {
    const data = getActiveData();
    data.settings.fNom = calcFNom(data.settings.workDaysPerMonth, data.settings.shiftHoursStandard);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById('btnRecalcFEff')?.addEventListener('click', () => {
    const data = getActiveData();
    data.settings.fEff = calcFEff(data.settings.fNom, data.settings.reserveOffPercent);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById('btnRecalcFNomExtended')?.addEventListener('click', () => {
    const data = getActiveData();
    data.settings.fNomExtended = calcExtendedFNom(data.settings.fNom, data.settings.extendedShiftHours, data.settings.shiftHoursStandard);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById('btnRecalcFEffExtended')?.addEventListener('click', () => {
    const data = getActiveData();
    data.settings.fEffExtended = calcFEff(data.settings.fNomExtended, data.settings.reserveOffPercent);
    storageService.saveState(state);
    renderAll();
  });

  document.getElementById('btnSyncAllFunds')?.addEventListener('click', () => {
    const data = getActiveData();
    const s = data.settings;
    s.fNom = calcFNom(s.workDaysPerMonth, s.shiftHoursStandard);
    s.fEff = calcFEff(s.fNom, s.reserveOffPercent);
    s.fNomExtended = calcExtendedFNom(s.fNom, s.extendedShiftHours, s.shiftHoursStandard);
    s.fEffExtended = calcFEff(s.fNomExtended, s.reserveOffPercent);
    storageService.saveState(state);
    renderAll();
    modalSystem.alert('Синхронизировано', 'Все фонды пересчитаны от текущего календаря.');
  });

  document.getElementById('btnResetCalendarDefaults')?.addEventListener('click', () => {
    const data = getActiveData();
    data.settings.workDaysPerMonth = 21;
    data.settings.shiftHoursStandard = 8;
    data.settings.extendedShiftHours = 12;
    storageService.saveState(state);
    renderAll();
  });

  const bindInput = (id: string, prop: keyof Settings, isNum: boolean = true) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const data = getActiveData();
      (data.settings as any)[prop] = isNum ? parseNum(target.value) : target.value;
      storageService.saveState(state);
      const freshCalc = calculateProgram(data);
      renderKPIs(freshCalc, data);
      renderExecutiveSummary(freshCalc, data);
      renderDynamicGuides(freshCalc, data);
      renderDictionariesInputs();
    });
  };

  bindInput('inputBrigadesCount', 'brigadesCount');
  bindInput('inputBrigadeSize', 'brigadeSize');
  bindInput('inputMaxOvertime', 'maxOvertimePercent');
  bindInput('inputAuxOtk', 'auxOtkPercent');
  bindInput('inputAuxSetup', 'auxSetupPercent');
  bindInput('inputAuxFixed', 'auxFixedPosts');
  bindInput('inputWorkDays', 'workDaysPerMonth');
  bindInput('inputShiftHours', 'shiftHoursStandard');
  bindInput('inputExtendedShiftHours', 'extendedShiftHours');
  bindInput('inputKVn', 'kVn');
  bindInput('inputReserveOff', 'reserveOffPercent');
  bindInput('inputCompanyName', 'companyName', false);
}

window.addEventListener('DOMContentLoaded', init);
