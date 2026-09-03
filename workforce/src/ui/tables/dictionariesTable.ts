// src/ui/tables/dictionariesTable.ts
import { ScenarioData } from '../../types';
import { parseNum } from '../../core/funds';
import { initTableDragAndDrop } from '../dnd';

const UNIT_PRESETS = ["м²", "шт", "м.п.", "кг", "т", "компл", "узлы", "партии"];

export function renderProfessionsTable(data: ScenarioData, onUpdated: () => void): void {
  const tbody = document.getElementById("professionsTableBody");
  if (!tbody) return;

  tbody.innerHTML = data.professions.map((prof, idx) => {
    const poolType = prof.pool || "universal";
    return `
      <tr data-index="${idx}">
        <td class="col-drag"><span class="drag-handle" title="Перетащите">☰</span></td>
        <td><input type="text" class="input-control prof-name" data-id="${prof.id}" value="${prof.name}"></td>
        <td style="text-align:center;">
          <select class="input-control prof-pool" data-id="${prof.id}" style="font-size:12px; font-weight:700;">
            <option value="universal" ${poolType === 'universal' ? 'selected' : ''}>Универсальный</option>
            <option value="dedicated" ${poolType === 'dedicated' ? 'selected' : ''}>Выделенный</option>
          </select>
        </td>
        <td><input type="number" min="1" class="input-control input-num prof-machines" data-id="${prof.id}" value="${prof.machines || 1}"></td>
        <td><input type="number" min="1" class="input-control input-num prof-crew" data-id="${prof.id}" value="${prof.crew || 1}"></td>
        <td><input type="number" min="0" class="input-control input-num prof-mincrew" data-id="${prof.id}" value="${prof.minCrew ?? 0}"></td>
        <td><input type="number" min="1" max="24" class="input-control input-num prof-avail" data-id="${prof.id}" value="${prof.availabilityHours ?? 24}"></td>
        <td style="text-align:center;"><button class="btn btn-secondary btn-sm btn-del-prof" data-id="${prof.id}">✕</button></td>
      </tr>
    `;
  }).join("");

  initTableDragAndDrop("professionsTableBody", (fromIdx, toIdx) => {
    const item = data.professions.splice(fromIdx, 1)[0];
    data.professions.splice(toIdx, 0, item);
    onUpdated();
  });
}

export function renderProductsTable(data: ScenarioData, onUpdated: () => void, onJumpToNorm: (prodId: string, profId: string) => void): void {
  const thead = document.getElementById("productsTableHeader");
  const tbody = document.getElementById("productsTableBody");
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <th class="col-drag"></th>
    <th class="col-sticky-name" style="min-width: 200px;">Изделие</th>
    <th style="min-width: 80px; text-align:center;">Ед.</th>
    <th style="min-width: 70px; text-align:right;">Брак, %</th>
    ${data.professions.map(pr => `<th style="min-width:85px; text-align:right;">${pr.name}</th>`).join("")}
    <th style="min-width: 80px; text-align:right;">Всего н-ч</th>
    <th style="width: 40px;"></th>
  `;

  tbody.innerHTML = data.products.map((p, idx) => {
    let totalNorm = 0;
    data.professions.forEach(pr => { totalNorm += parseNum(p.norms[pr.id]); });
    const unitList = Array.from(new Set([p.unit || "м²", ...UNIT_PRESETS]));

    return `
      <tr data-index="${idx}">
        <td class="col-drag"><span class="drag-handle" title="Перетащите">☰</span></td>
        <td class="col-sticky-name"><input type="text" class="input-control prod-name" data-id="${p.id}" value="${p.name}"></td>
        <td style="text-align:center;">
          <select class="input-control prod-unit" data-id="${p.id}">
            ${unitList.map(u => `<option value="${u}" ${p.unit === u ? 'selected' : ''}>${u}</option>`).join("")}
          </select>
        </td>
        <td><input type="text" class="input-control input-num prod-scrap" data-id="${p.id}" value="${p.scrap || 0}"></td>
        ${data.professions.map(pr => {
          const normKey = `${p.id}___${pr.id}`;
          const hasCfg = !!(data.normConfigs && data.normConfigs[normKey]);
          return `
            <td class="norm-cell-wrap" style="position:relative;">
              <input type="text" class="input-control input-num prod-norm" data-prod="${p.id}" data-prof="${pr.id}" value="${p.norms[pr.id] ?? 0}">
              <button class="norm-jump-btn ${hasCfg ? 'has-config' : ''}" data-prod="${p.id}" data-prof="${pr.id}" title="Открыть калькулятор нормирования">⚡</button>
            </td>
          `;
        }).join("")}
        <td style="text-align:right; font-weight:700;">${totalNorm.toFixed(2)}</td>
        <td style="text-align:center;"><button class="btn btn-secondary btn-sm btn-del-prod" data-id="${p.id}">✕</button></td>
      </tr>
    `;
  }).join("");

  tbody.onclick = (e) => {
    const jumpBtn = (e.target as HTMLElement).closest(".norm-jump-btn");
    if (jumpBtn) {
      const prodId = jumpBtn.getAttribute("data-prod")!;
      const profId = jumpBtn.getAttribute("data-prof")!;
      onJumpToNorm(prodId, profId);
    }
  };

  initTableDragAndDrop("productsTableBody", (fromIdx, toIdx) => {
    const item = data.products.splice(fromIdx, 1)[0];
    data.products.splice(toIdx, 0, item);
    onUpdated();
  });
}
