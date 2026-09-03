// src/ui/normingTab.ts
import { ScenarioData, NormConfigEntry } from '../types';
import { parseNum } from '../core/funds';
import { calculateStatNorm, calculateChronoNorm } from '../core/norming';
import { modalSystem } from './modal';

let currentMethod: 'stat' | 'chrono' = 'stat';

export function setupNormingTab(
  data: ScenarioData,
  onNormPushed: (prodId: string, profId: string, norm: number, entry: NormConfigEntry) => void,
  onConfigDeleted: (key: string) => void
): void {
  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement;
  const btnStat = document.getElementById("btnNormMethodStat");
  const btnChrono = document.getElementById("btnNormMethodChrono");

  btnStat?.addEventListener("click", () => setMethod('stat'));
  btnChrono?.addEventListener("click", () => setMethod('chrono'));

  prodSel?.addEventListener("change", () => {
    loadSavedConfigIntoInputs(data, prodSel.value, profSel.value);
    recalc();
  });
  profSel?.addEventListener("change", () => {
    loadSavedConfigIntoInputs(data, prodSel.value, profSel.value);
    recalc();
  });

  function populateDropdowns() {
    if (!prodSel || !profSel) return;
    const curProd = prodSel.value;
    const curProf = profSel.value;
    prodSel.innerHTML = data.products.map(p => `<option value="${p.id}" ${p.id === curProd ? 'selected' : ''}>${p.name} (${p.unit})</option>`).join("");
    profSel.innerHTML = data.professions.map(pr => `<option value="${pr.id}" ${pr.id === curProf ? 'selected' : ''}>${pr.name}</option>`).join("");
  }

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

    // Сравнение с текущей нормой в матрице
    const pId = prodSel?.value;
    const prId = profSel?.value;
    const prod = data.products.find(p => p.id === pId);
    const matrixVal = prod?.norms[prId] ? parseNum(prod.norms[prId]) : 0;

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
        updatedAt: new Date().toLocaleDateString("ru-RU")
      };
      onNormPushed(prodId, profId, normVal, entry);
      recalc();
    }
  });

  populateDropdowns();
  loadSavedConfigIntoInputs(data, prodSel?.value, profSel?.value);
  recalc();
  renderSavedNormsRegistry(data, onConfigDeleted);
}

function loadSavedConfigIntoInputs(data: ScenarioData, prodId: string, profId: string) {
  const key = `${prodId}___${profId}`;
  const cfg = data.normConfigs?.[key];
  if (!cfg) return;

  if (cfg.method === 'stat' && cfg.stat) {
    (document.getElementById("normStatOutput") as HTMLInputElement).value = String(cfg.stat.output);
    (document.getElementById("normStatWorkers") as HTMLInputElement).value = String(cfg.stat.workers);
    (document.getElementById("normStatShiftHours") as HTMLInputElement).value = String(cfg.stat.shiftHours);
    (document.getElementById("normStatBreaks") as HTMLInputElement).value = String(cfg.stat.breaks);
  } else if (cfg.method === 'chrono' && cfg.chrono) {
    (document.getElementById("normChronoTOsn") as HTMLInputElement).value = String(cfg.chrono.tOsn);
    (document.getElementById("normChronoTVsp") as HTMLInputElement).value = String(cfg.chrono.tVsp);
    (document.getElementById("normChronoCrew") as HTMLInputElement).value = String(cfg.chrono.crew);
    (document.getElementById("normChronoTPz") as HTMLInputElement).value = String(cfg.chrono.tPz);
  }
}

export function openNormingFor(prodId: string, profId: string): void {
  const tabBtn = document.querySelector('.tab-button[data-tab="tab-norming"]') as HTMLButtonElement;
  tabBtn?.click();

  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement;
  if (prodSel) prodSel.value = prodId;
  if (profSel) profSel.value = profId;
}

export function renderSavedNormsRegistry(data: ScenarioData, onDelete: (key: string) => void): void {
  const tbody = document.getElementById("savedNormsTableBody");
  const countEl = document.getElementById("savedNormsCount");
  if (!tbody || !countEl) return;

  const configs = data.normConfigs || {};
  const keys = Object.keys(configs);
  countEl.textContent = String(keys.length);

  if (keys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">В реестре пока нет зафиксированных норм. Рассчитайте норму и нажмите «Перенести в матрицу норм».</td></tr>`;
    return;
  }

  tbody.innerHTML = keys.map(key => {
    const item = configs[key];
    return `
      <tr>
        <td><strong>${item.prodName}</strong></td>
        <td>${item.profName}</td>
        <td style="text-align:center;">
          <span class="${item.method === 'chrono' ? 'badge-shift-12' : 'badge-shift-2'}" style="font-size:11px;">
            ${item.method === 'chrono' ? 'Хронометраж' : 'Статистика смены'}
          </span>
        </td>
        <td style="text-align:right; font-weight:700; color:var(--accent);">${item.norm.toFixed(3)}</td>
        <td style="text-align:center; font-size:11.5px; color:var(--text-muted);">${item.updatedAt || '—'}</td>
        <td style="text-align:center;">
          <button class="btn btn-secondary btn-sm btn-del-norm-cfg" data-key="${key}" title="Удалить запись">✕</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest(".btn-del-norm-cfg");
    if (btn) {
      const key = btn.getAttribute("data-key")!;
      modalSystem.confirm("Удаление нормы", `Удалить запись из реестра?`, () => {
        onDelete(key);
      });
    }
  };
}
