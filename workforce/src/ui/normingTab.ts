// src/ui/normingTab.ts
import { ScenarioData, NormConfigEntry, AppState } from '../types';
import { parseNum } from '../core/funds';
import { calculateStatNorm, calculateChronoNorm } from '../core/norming';
import { storageService } from '../services/storage/storageService';
import { modalSystem } from './modal';

let currentMethod: 'stat' | 'chrono' = 'stat';

function escapeHtml(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function setupNormingTab(
  getData: () => ScenarioData,
  getState: () => AppState,
  onAfterUpdate: () => void
): void {
  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement | null;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement | null;
  const btnStat = document.getElementById("btnNormMethodStat");
  const btnChrono = document.getElementById("btnNormMethodChrono");

  btnStat?.addEventListener("click", () => setMethod('stat'));
  btnChrono?.addEventListener("click", () => setMethod('chrono'));

  prodSel?.addEventListener("change", () => {
    loadSavedConfigIntoInputs(getData(), prodSel.value, profSel?.value || "");
    recalc();
  });
  profSel?.addEventListener("change", () => {
    loadSavedConfigIntoInputs(getData(), prodSel?.value || "", profSel.value);
    recalc();
  });

  function setMethod(method: 'stat' | 'chrono') {
    currentMethod = method;
    btnStat?.classList.toggle("active", method === 'stat');
    btnChrono?.classList.toggle("active", method === 'chrono');
    const fStat = document.getElementById("normFieldsStat");
    const fChrono = document.getElementById("normFieldsChrono");
    const aStat = document.getElementById("normActionStat");
    const aChrono = document.getElementById("normActionChrono");

    if (fStat) fStat.style.display = method === 'stat' ? 'block' : 'none';
    if (fChrono) fChrono.style.display = method === 'chrono' ? 'block' : 'none';
    if (aStat) aStat.style.display = method === 'stat' ? 'flex' : 'none';
    if (aChrono) aChrono.style.display = method === 'chrono' ? 'flex' : 'none';

    recalc();
  }

  function recalc(): number {
    const data = getData();
    const q = parseNum((document.getElementById("normStatOutput") as HTMLInputElement)?.value) || 1;
    const w = parseNum((document.getElementById("normStatWorkers") as HTMLInputElement)?.value) || 1;
    const h = parseNum((document.getElementById("normStatShiftHours") as HTMLInputElement)?.value) || 8;
    const b = parseNum((document.getElementById("normStatBreaks") as HTMLInputElement)?.value) || 0;
    const kEff = parseNum((document.getElementById("normStatKEff") as HTMLInputElement)?.value) || 0.95;

    const netHours = Math.max(0, h - (b / 60));
    const statNorm = (w * netHours * kEff) / q;

    const tOsn = parseNum((document.getElementById("normChronoTOsn") as HTMLInputElement)?.value);
    const tVsp = parseNum((document.getElementById("normChronoTVsp") as HTMLInputElement)?.value);
    const crew = parseNum((document.getElementById("normChronoCrew") as HTMLInputElement)?.value) || 1;
    const kObs = parseNum((document.getElementById("normChronoKObs") as HTMLInputElement)?.value);
    const kOtl = parseNum((document.getElementById("normChronoKOtl") as HTMLInputElement)?.value);
    const tPz = parseNum((document.getElementById("normChronoTPz") as HTMLInputElement)?.value);
    const batchSize = parseNum((document.getElementById("normChronoBatchSize") as HTMLInputElement)?.value) || 50;

    const tOp = tOsn + tVsp;
    const pieceCycle = (tOp * (1 + (kObs + kOtl) / 100)) + (tPz / batchSize);
    const chronoNorm = (pieceCycle * crew) / 60;

    const activeNorm = currentMethod === 'stat' ? statNorm : chronoNorm;

    // Обновляем результаты для обоих методов
    const statResEl = document.getElementById("normStatResult");
    const chronoResEl = document.getElementById("normChronoResult");
    const genericResEl = document.getElementById("normResultText");
    if (statResEl) statResEl.textContent = `${statNorm.toFixed(3)} н-ч / ед`;
    if (chronoResEl) chronoResEl.textContent = `${chronoNorm.toFixed(3)} н-ч / ед`;
    if (genericResEl) genericResEl.textContent = `${activeNorm.toFixed(3)} н-ч / ед`;

    const pId = prodSel?.value;
    const prId = profSel?.value;
    const prod = data.products.find(p => p.id === pId);
    const matrixVal = (prod?.norms && prId && prod.norms[prId] !== undefined) ? parseNum(prod.norms[prId]) : 0;

    const statMatEl = document.getElementById("normStatMatrixVal");
    const chronoMatEl = document.getElementById("normChronoMatrixVal");
    const genericMatEl = document.getElementById("normMatrixValText");
    if (statMatEl) statMatEl.textContent = `(в матрице: ${matrixVal.toFixed(3)})`;
    if (chronoMatEl) chronoMatEl.textContent = `(в матрице: ${matrixVal.toFixed(3)})`;
    if (genericMatEl) genericMatEl.textContent = `(в матрице: ${matrixVal.toFixed(3)})`;

    const badge = document.getElementById("normSyncBadge");
    if (badge) {
      if (Math.abs(matrixVal - activeNorm) < 0.001 && activeNorm > 0) {
        badge.className = "badge-sync-ok";
        badge.textContent = "Синхронизировано";
      } else {
        badge.className = "badge-sync-diff";
        badge.textContent = "Требуется перенос";
      }
    }

    return activeNorm;
  }

  document.querySelectorAll("#normFieldsStat input, #normFieldsChrono input").forEach(inp => {
    inp.addEventListener("input", () => recalc());
  });

  // ЕДИНЫЙ ОБРАБОТЧИК КЛИКА: ПЕРЕНОС В МАТРИЦУ И В РЕЕСТР
  const executePushNorm = () => {
    const data = getData();
    const state = getState();
    if (!prodSel || !profSel) return;

    const prodId = prodSel.value;
    const profId = profSel.value;
    if (!prodId || !profId) return;

    const normVal = parseFloat(recalc().toFixed(3));
    const prod = data.products.find(p => p.id === prodId);
    const prof = data.professions.find(pr => pr.id === profId);

    if (prod && prof) {
      // 1. Записываем норму в изделие (в матрицу продукции на Вкладке 2)
      if (!prod.norms) prod.norms = {};
      prod.norms[profId] = normVal;

      // 2. Создаем детальную запись для реестра
      const isStat = currentMethod === 'stat';
      const entry: NormConfigEntry = {
        prodId, profId,
        prodName: prod.name, profName: prof.name,
        method: currentMethod,
        norm: normVal,
        stat: isStat ? {
          output: parseNum((document.getElementById("normStatOutput") as HTMLInputElement)?.value),
          workers: parseNum((document.getElementById("normStatWorkers") as HTMLInputElement)?.value),
          shiftHours: parseNum((document.getElementById("normStatShiftHours") as HTMLInputElement)?.value),
          breaks: parseNum((document.getElementById("normStatBreaks") as HTMLInputElement)?.value),
          kEff: parseNum((document.getElementById("normStatKEff") as HTMLInputElement)?.value) || 0.95
        } : undefined,
        chrono: !isStat ? {
          tOsn: parseNum((document.getElementById("normChronoTOsn") as HTMLInputElement)?.value),
          tVsp: parseNum((document.getElementById("normChronoTVsp") as HTMLInputElement)?.value),
          crew: parseNum((document.getElementById("normChronoCrew") as HTMLInputElement)?.value),
          kObs: parseNum((document.getElementById("normChronoKObs") as HTMLInputElement)?.value),
          kOtl: parseNum((document.getElementById("normChronoKOtl") as HTMLInputElement)?.value),
          tPz: parseNum((document.getElementById("normChronoTPz") as HTMLInputElement)?.value),
          batchSize: parseNum((document.getElementById("normChronoBatchSize") as HTMLInputElement)?.value) || 50
        } : undefined,
        updatedAt: new Date().toLocaleString("ru-RU", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      };

      // 3. Сохраняем в реестр сценария
      if (!data.normConfigs) data.normConfigs = {};
      data.normConfigs[`${prodId}___${profId}`] = entry;

      // 4. Отправляем в Supabase и LocalStorage
      storageService.saveState(state);

      // 5. Перерисовываем реестр и все зависимые таблицы
      recalc();
      renderSavedNormsRegistry(data, (delKey) => {
        if (data.normConfigs) delete data.normConfigs[delKey];
        storageService.saveState(state);
        onAfterUpdate();
      });
      onAfterUpdate();

      modalSystem.alert(
        "Норма сохранена",
        `Норма <strong>${normVal.toFixed(3)} н-ч</strong> для «${prod.name}» (участок: ${prof.name}) записана в матрицу норм и зафиксирована в реестре.`
      );
    }
  };

  // Слушаем ВСЕ возможные кнопки переноса нормы в DOM
  document.getElementById("btnPushStatNormToRouting")?.addEventListener("click", executePushNorm);
  document.getElementById("btnPushChronoNormToRouting")?.addEventListener("click", executePushNorm);
  document.getElementById("btnPushNormToMatrix")?.addEventListener("click", executePushNorm);

  refreshNormingDropdowns(getData());
  loadSavedConfigIntoInputs(getData(), prodSel?.value || "", profSel?.value || "");
  recalc();
  renderSavedNormsRegistry(getData(), (key) => {
    const d = getData();
    if (d.normConfigs) delete d.normConfigs[key];
    storageService.saveState(getState());
    onAfterUpdate();
  });
}

export function refreshNormingDropdowns(data: ScenarioData): void {
  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement | null;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement | null;
  if (!prodSel || !profSel) return;

  const curProd = prodSel.value;
  const curProf = profSel.value;
  prodSel.innerHTML = data.products.map(p => `<option value="${p.id}" ${p.id === curProd ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.unit || 'м²')})</option>`).join("");
  profSel.innerHTML = data.professions.map(pr => `<option value="${pr.id}" ${pr.id === curProf ? 'selected' : ''}>${escapeHtml(pr.name)}</option>`).join("");
}

export function loadSavedConfigIntoInputs(data: ScenarioData, prodId: string, profId: string): void {
  const key = `${prodId}___${profId}`;
  const cfg = data.normConfigs?.[key];

  if (cfg) {
    if (cfg.method === 'stat' && cfg.stat) {
      (document.getElementById("normStatOutput") as HTMLInputElement).value = String(cfg.stat.output ?? 50);
      (document.getElementById("normStatWorkers") as HTMLInputElement).value = String(cfg.stat.workers ?? 3);
      (document.getElementById("normStatShiftHours") as HTMLInputElement).value = String(cfg.stat.shiftHours ?? 8.0);
      (document.getElementById("normStatBreaks") as HTMLInputElement).value = String(cfg.stat.breaks ?? 40);
      (document.getElementById("normStatKEff") as HTMLInputElement).value = String(cfg.stat.kEff ?? 0.95);
      document.getElementById("btnNormMethodStat")?.click();
    } else if (cfg.method === 'chrono' && cfg.chrono) {
      (document.getElementById("normChronoTOsn") as HTMLInputElement).value = String(cfg.chrono.tOsn ?? 12.0);
      (document.getElementById("normChronoTVsp") as HTMLInputElement).value = String(cfg.chrono.tVsp ?? 4.0);
      (document.getElementById("normChronoCrew") as HTMLInputElement).value = String(cfg.chrono.crew ?? 2);
      (document.getElementById("normChronoKObs") as HTMLInputElement).value = String(cfg.chrono.kObs ?? 5);
      (document.getElementById("normChronoKOtl") as HTMLInputElement).value = String(cfg.chrono.kOtl ?? 6);
      (document.getElementById("normChronoTPz") as HTMLInputElement).value = String(cfg.chrono.tPz ?? 30);
      (document.getElementById("normChronoBatchSize") as HTMLInputElement).value = String(cfg.chrono.batchSize ?? 50);
      document.getElementById("btnNormMethodChrono")?.click();
    }
  } else {
    // Дефолтные числа при отсутствии сохранённой нормы
    (document.getElementById("normStatOutput") as HTMLInputElement).value = "50";
    (document.getElementById("normStatWorkers") as HTMLInputElement).value = "3";
    (document.getElementById("normStatShiftHours") as HTMLInputElement).value = "8.0";
    (document.getElementById("normStatBreaks") as HTMLInputElement).value = "40";
    (document.getElementById("normStatKEff") as HTMLInputElement).value = "0.95";
  }
}

export function openNormingFor(prodId: string, profId: string, data: ScenarioData): void {
  const tabBtn = document.querySelector('.tab-button[data-tab="tab-norming"]') as HTMLButtonElement | null;
  tabBtn?.click();

  refreshNormingDropdowns(data);
  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement | null;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement | null;
  if (prodSel) prodSel.value = prodId;
  if (profSel) profSel.value = profId;

  loadSavedConfigIntoInputs(data, prodId, profId);
}

export function renderSavedNormsRegistry(data: ScenarioData, onDelete: (key: string) => void): void {
  const tbody = document.getElementById("savedNormsTableBody");
  const countEl = document.getElementById("savedNormsCount");
  if (!tbody || !countEl) return;

  const configs = data.normConfigs || {};
  const keys = Object.keys(configs);
  countEl.textContent = String(keys.length);

  if (keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:16px;">В реестре пока нет зафиксированных технологических расчетов. Рассчитайте норму и нажмите «Перенести в матрицу норм».</td></tr>`;
    return;
  }

  tbody.innerHTML = keys.map(key => {
    const item = configs[key];
    const prod = data.products.find(p => p.id === item.prodId) || { name: item.prodName || item.prodId, unit: "м²" };
    const prof = data.professions.find(pr => pr.id === item.profId) || { name: item.profName || item.profId };

    const methodBadge = item.method === 'chrono'
      ? `<span class="badge-shift-12" style="font-size:11px;">Хронометраж</span>`
      : `<span class="badge-shift-2" style="font-size:11px;">Статистика смены</span>`;

    let paramDesc = "";
    if (item.method === 'chrono' && item.chrono) {
      paramDesc = `T<sub>осн</sub>=${item.chrono.tOsn}м, T<sub>всп</sub>=${item.chrono.tVsp}м, Звено=${item.chrono.crew} чел, ПЗ=${item.chrono.tPz}м/парт.${item.chrono.batchSize || 50}шт (обсл: ${item.chrono.kObs || 5}%, отд: ${item.chrono.kOtl || 6}%)`;
    } else if (item.stat) {
      paramDesc = `Q=${item.stat.output} ${escapeHtml(prod.unit || 'ед')}, N<sub>раб</sub>=${item.stat.workers} чел, Смена=${item.stat.shiftHours}ч, Перерывы=${item.stat.breaks}м, K<sub>эф</sub>=${item.stat.kEff || 0.95}`;
    }

    return `
      <tr>
        <td><strong>${escapeHtml(prod.name)}</strong> <span class="badge-unit">${escapeHtml(prod.unit || 'м²')}</span></td>
        <td>${escapeHtml(prof.name)}</td>
        <td style="text-align:center;">${methodBadge}</td>
        <td style="font-size:12px; color:var(--text-secondary);">${paramDesc}</td>
        <td style="text-align:right; font-weight:700; color:var(--accent);">${item.norm.toFixed(3)}</td>
        <td style="text-align:center; font-size:11.5px; color:var(--text-muted);">${escapeHtml(item.updatedAt || '—')}</td>
        <td style="text-align:center;">
          <button class="btn btn-secondary btn-sm btn-load-norm-cfg" data-prod="${item.prodId}" data-prof="${item.profId}" title="Загрузить параметры в калькулятор">
            <svg class="icon"><use href="#icon-external"></use></svg>
          </button>
          <button class="btn btn-secondary btn-sm btn-del-norm-cfg" data-key="${key}" title="Удалить обоснование">
            <svg class="icon"><use href="#icon-trash"></use></svg>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.onclick = (e) => {
    const target = e.target as HTMLElement;
    const btnLoad = target.closest(".btn-load-norm-cfg");
    const btnDel = target.closest(".btn-del-norm-cfg");

    if (btnLoad) {
      const prodId = btnLoad.getAttribute("data-prod")!;
      const profId = btnLoad.getAttribute("data-prof")!;
      openNormingFor(prodId, profId, data);
      modalSystem.alert("Загружено", "Параметры успешно восстановлены в окне калькулятора!");
    } else if (btnDel) {
      const key = btnDel.getAttribute("data-key")!;
      modalSystem.confirm("Удаление обоснования", "Удалить запись из реестра технологических расчетов?", () => {
        onDelete(key);
      });
    }
  };
}
