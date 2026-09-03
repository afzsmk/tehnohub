// src/ui/normingTab.ts
import { ScenarioData, NormConfigEntry } from '../types';
import { parseNum } from '../../core/funds';
import { calculateStatNorm, calculateChronoNorm } from '../../core/norming';

let currentMethod: 'stat' | 'chrono' = 'stat';

export function setupNormingTab(data: ScenarioData, onNormPushed: (prodId: string, profId: string, norm: number, entry: NormConfigEntry) => void): void {
  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement;
  const btnStat = document.getElementById("btnNormMethodStat");
  const btnChrono = document.getElementById("btnNormMethodChrono");

  btnStat?.addEventListener("click", () => setMethod('stat'));
  btnChrono?.addEventListener("click", () => setMethod('chrono'));

  function populateDropdowns() {
    if (!prodSel || !profSel) return;
    prodSel.innerHTML = data.products.map(p => `<option value="${p.id}">${p.name} (${p.unit})</option>`).join("");
    profSel.innerHTML = data.professions.map(pr => `<option value="${pr.id}">${pr.name}</option>`).join("");
  }

  function setMethod(method: 'stat' | 'chrono') {
    currentMethod = method;
    btnStat?.classList.toggle("active", method === 'stat');
    btnChrono?.classList.toggle("active", method === 'chrono');
    document.getElementById("normFieldsStat")!.style.display = method === 'stat' ? 'block' : 'none';
    document.getElementById("normFieldsChrono")!.style.display = method === 'chrono' ? 'block' : 'none';
    recalc();
  }

  function recalc(): number {
    let norm = 0;
    if (currentMethod === 'stat') {
      norm = calculateStatNorm({
        output: parseNum((document.getElementById("normStatOutput") as HTMLInputElement).value),
        workers: parseNum((document.getElementById("normStatWorkers") as HTMLInputElement).value),
        shiftHours: parseNum((document.getElementById("normStatShiftHours") as HTMLInputElement).value),
        breaks: parseNum((document.getElementById("normStatBreaks") as HTMLInputElement).value),
        kEff: 0.95
      });
    } else {
      norm = calculateChronoNorm({
        tOsn: parseNum((document.getElementById("normChronoTOsn") as HTMLInputElement).value),
        tVsp: parseNum((document.getElementById("normChronoTVsp") as HTMLInputElement).value),
        crew: parseNum((document.getElementById("normChronoCrew") as HTMLInputElement).value),
        kObs: 5,
        kOtl: 6,
        tPz: parseNum((document.getElementById("normChronoTPz") as HTMLInputElement).value),
        batchSize: 50
      });
    }

    const resEl = document.getElementById("normResultText");
    if (resEl) resEl.textContent = `${norm.toFixed(3)} н-ч / ед`;
    return norm;
  }

  document.querySelectorAll("#normFieldsStat input, #normFieldsChrono input").forEach(inp => {
    inp.addEventListener("input", () => recalc());
  });

  document.getElementById("btnPushNormToMatrix")?.addEventListener("click", () => {
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
    }
  });

  populateDropdowns();
  recalc();
}

export function openNormingFor(prodId: string, profId: string): void {
  const tabBtn = document.querySelector('.tab-button[data-tab="tab-norming"]') as HTMLButtonElement;
  tabBtn?.click();

  const prodSel = document.getElementById("normProdSelect") as HTMLSelectElement;
  const profSel = document.getElementById("normProfSelect") as HTMLSelectElement;
  if (prodSel) prodSel.value = prodId;
  if (profSel) profSel.value = profId;
}
