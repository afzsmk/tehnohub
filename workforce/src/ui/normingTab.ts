// src/ui/normingTab.ts
import { ScenarioData, NormConfigEntry } from '../types';
import { parseNum } from '../core/funds';
import { calculateStatNorm, calculateChronoNorm } from '../core/norming';
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
  data: ScenarioData,
  onNormPushed: (prodId: string, profId: string, norm: number, entry: NormConfigEntry) => void,
  onConfigDeleted?: (key: string) => void
): void {
  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement | null;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement | null;
  const btnStat = document.getElementById("btnNormMethodStat");
  const btnChrono = document.getElementById("btnNormMethodChrono");

  btnStat?.addEventListener("click", () => setMethod('stat'));
  btnChrono?.addEventListener("click", () => setMethod('chrono'));

  prodSel?.addEventListener("change", () => {
    loadSavedConfigIntoInputs(data, prodSel.value, profSel?.value || "");
    recalc();
  });
  profSel?.addEventListener("change", () => {
    loadSavedConfigIntoInputs(data, prodSel?.value || "", profSel.value);
    recalc();
  });

  function setMethod(method: 'stat' | 'chrono') {
    currentMethod = method;
    btnStat?.classList.toggle("active", method === 'stat');
    btnChrono?.classList.toggle("active", method === 'chrono');
    const fStat = document.getElementById("normFieldsStat");
    const fChrono = document.getElementById("normFieldsChrono");
    if (fStat) fStat.style.display = method === 'stat' ? 'block' : 'none';
    if (fChrono) fChrono.style.display = method === 'chrono' ? 'block' : 'none';
    recalc();
  }

  function recalc(): number {
    let norm = 0;
    if (currentMethod === 'stat') {
      norm = calculateStatNorm({
        output: parseNum((document.getElementById("normStatOutput") as HTMLInputElement)?.value),
        workers: parseNum((document.getElementById("normStatWorkers") as HTMLInputElement)?.value),
        shiftHours: parseNum((document.getElementById("normStatShiftHours") as HTMLInputElement)?.value),
        breaks: parseNum((document.getElementById("normStatBreaks") as HTMLInputElement)?.value),
        kEff: 0.95
      });
    } else {
      norm = calculateChronoNorm({
        tOsn: parseNum((document.getElementById("normChronoTOsn") as HTMLInputElement)?.value),
        tVsp: parseNum((document.getElementById("normChronoTVsp") as HTMLInputElement)?.value),
        crew: parseNum((document.getElementById("normChronoCrew") as HTMLInputElement)?.value),
        kObs: 5,
        kOtl: 6,
        tPz: parseNum((document.getElementById("normChronoTPz") as HTMLInputElement)?.value),
        batchSize: 50
      });
    }

    const resEl = document.getElementById("normResultText");
    if (resEl) resEl.textContent = `${norm.toFixed(3)} н-ч / ед`;

    const pId = prodSel?.value;
    const prId = profSel?.value;
    const prod = data.products.find(p => p.id === pId);
    const matrixVal = (prod?.norms && prId && prod.norms[prId] !== undefined) ? parseNum(prod.norms[prId]) : 0;

    const matrixValEl = document.getElementById("normMatrixValText");
    if (matrixValEl) matrixValEl.textContent = `(в матрице: ${matrixVal.toFixed(3)})`;

    const badge = document.getElementById("normSyncBadge");
    if (badge) {
      if (Math.abs(matrixVal - norm) < 0.001 && norm > 0) {
        badge.className = "badge-sync-ok";
        badge.textContent = "Синхронизировано";
      } else {
        badge.className = "badge-sync-diff";
        badge.textContent = "Требуется перенос";
      }
    }

    return norm;
  }

  document.querySelectorAll("#normFieldsStat input, #normFieldsChrono input").forEach(inp => {
    inp.addEventListener("input", () => recalc());
  });

  // КЛИК: ПЕРЕНЕСТИ В МАТРИЦУ НОРМ
  document.getElementById("btnPushNormToMatrix")?.addEventListener("click", () => {
    if (!prodSel || !profSel) return;
    const prodId = prodSel.value;
    const profId = profSel.value;
    const normVal = parseFloat(recalc().toFixed(3));
    const prod = data.products.find(p => p.id === prodId);
    const prof = data.professions.find(pr => pr.id === profId);

    if (prod && prof) {
      const entry: NormConfigEntry = {
        prodId, profId,
        prodName: prod.name, profName: prof.name,
        method: currentMethod,
        norm: normVal,
        stat: currentMethod === 'stat' ? {
          output: parseNum((document.getElementById("normStatOutput") as HTMLInputElement)?.value),
          workers: parseNum((document.getElementById("normStatWorkers") as HTMLInputElement)?.value),
          shiftHours: parseNum((document.getElementById("normStatShiftHours") as HTMLInputElement)?.value),
          breaks: parseNum((document.getElementById("normStatBreaks") as HTMLInputElement)?.value),
          kEff: 0.95
        } : undefined,
        chrono: currentMethod === 'chrono' ? {
          tOsn: parseNum((document.getElementById("normChronoTOsn") as HTMLInputElement)?.value),
          tVsp: parseNum((document.getElementById("normChronoTVsp") as HTMLInputElement)?.value),
          crew: parseNum((document.getElementById("normChronoCrew") as HTMLInputElement)?.value),
          kObs: 5,
          kOtl: 6,
          tPz: parseNum((document.getElementById("normChronoTPz") as HTMLInputElement)?.value),
          batchSize: 50
        } : undefined,
        updatedAt: new Date().toLocaleString("ru-RU", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      };

      onNormPushed(prodId, profId, normVal, entry);
      recalc();
      renderSavedNormsRegistry(data, onConfigDeleted || (() => {}));
    }
  });

  refreshNormingDropdowns(data);
  loadSavedConfigIntoInputs(data, prodSel?.value || "", profSel?.value || "");
  recalc();
  renderSavedNormsRegistry(data, onConfigDeleted || (() => {}));
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
      (document.getElementById("normStatOutput") as HTMLInputElement).value = String(cfg.stat.output);
      (document.getElementById("normStatWorkers") as HTMLInputElement).value = String(cfg.stat.workers);
      (document.getElementById("normStatShiftHours") as HTMLInputElement).value = String(cfg.stat.shiftHours);
      (document.getElementById("normStatBreaks") as HTMLInputElement).value = String(cfg.stat.breaks);
      document.getElementById("btnNormMethodStat")?.click();
    } else if (cfg.method === 'chrono' && cfg.chrono) {
      (document.getElementById("normChronoTOsn") as HTMLInputElement).value = String(cfg.chrono.tOsn);
      (document.getElementById("normChronoTVsp") as HTMLInputElement).value = String(cfg.chrono.tVsp);
      (document.getElementById("normChronoCrew") as HTMLInputElement).value = String(cfg.chrono.crew);
      (document.getElementById("normChronoTPz") as HTMLInputElement).value = String(cfg.chrono.tPz);
      document.getElementById("btnNormMethodChrono")?.click();
    }
  } else {
    // Дефолтные значения при отсутствии сохранённой нормы
    (document.getElementById("normStatOutput") as HTMLInputElement).value = "50";
    (document.getElementById("normStatWorkers") as HTMLInputElement).value = "3";
    (document.getElementById("normStatShiftHours") as HTMLInputElement).value = "8.0";
    (document.getElementById("normStatBreaks") as HTMLInputElement).value = "40";
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:16px;">В реестре пока нет зафиксированных норм. Рассчитайте норму и нажмите «Перенести в матрицу норм».</td></tr>`;
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
          <button class="btn btn-secondary btn-sm btn-del-norm-cfg" data-key="${key}" title="Удалить запись">
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
      modalSystem.alert("Загружено", "Параметры успешно восстановлены в окне калькулятора.");
    } else if (btnDel) {
      const key = btnDel.getAttribute("data-key")!;
      modalSystem.confirm("Удаление нормы", "Удалить запись из реестра технологических расчётов?", () => {
        onDelete(key);
      });
    }
  };
}
