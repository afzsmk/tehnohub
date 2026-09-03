// src/ui/tables/dictionariesTable.ts
import { ScenarioData } from '../../types';
import { parseNum } from '../../core/funds';
import { initTableDragAndDrop } from '../dnd';
import { modalSystem } from '../modal';

const UNIT_PRESETS = ["м²", "шт", "м.п.", "кг", "т", "компл", "узлы", "партии"];

function escapeHtml(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderProfessionsTable(data: ScenarioData, onUpdated: () => void): void {
  const tbody = document.getElementById("professionsTableBody");
  if (!tbody) return;

  tbody.innerHTML = data.professions.map((prof, idx) => {
    const poolType = prof.pool || "universal";
    return `
      <tr data-index="${idx}">
        <td class="col-drag">
          <span class="drag-handle" title="Перетащите для изменения порядка">
            <svg class="icon"><use href="#icon-grip"></use></svg>
          </span>
        </td>
        <td><input type="text" class="input-control prof-name" data-id="${prof.id}" value="${escapeHtml(prof.name)}"></td>
        <td style="text-align:center;">
          <select class="input-control prof-pool" data-id="${prof.id}" style="font-size:12px; font-weight:700;">
            <option value="universal" ${poolType === 'universal' ? 'selected' : ''}>Универсальный пул</option>
            <option value="dedicated" ${poolType === 'dedicated' ? 'selected' : ''}>Выделенный пост</option>
          </select>
        </td>
        <td><input type="number" min="1" class="input-control input-num prof-machines" data-id="${prof.id}" value="${prof.machines || 1}"></td>
        <td><input type="number" min="1" class="input-control input-num prof-crew" data-id="${prof.id}" value="${prof.crew || 1}"></td>
        <td><input type="number" min="0" class="input-control input-num prof-mincrew" data-id="${prof.id}" value="${prof.minCrew !== undefined ? prof.minCrew : (poolType === 'dedicated' ? 1 : 0)}"></td>
        <td><input type="number" min="1" max="24" step="0.5" class="input-control input-num prof-avail" data-id="${prof.id}" value="${prof.availabilityHours !== undefined ? prof.availabilityHours : 24}"></td>
        <td style="text-align:center;">
          <button class="btn btn-secondary btn-sm btn-del-prof" data-id="${prof.id}" title="Удалить участок">
            <svg class="icon"><use href="#icon-trash"></use></svg>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  // Делегирование событий на таблице участков
  tbody.oninput = (e) => {
    const target = e.target as HTMLInputElement;
    const id = target.getAttribute("data-id")!;
    const p = data.professions.find(x => x.id === id);
    if (!p) return;

    if (target.classList.contains("prof-name")) p.name = target.value;
    else if (target.classList.contains("prof-machines")) p.machines = Math.max(1, parseInt(target.value) || 1);
    else if (target.classList.contains("prof-crew")) p.crew = Math.max(1, parseInt(target.value) || 1);
    else if (target.classList.contains("prof-mincrew")) p.minCrew = Math.max(0, parseInt(target.value) || 0);
    else if (target.classList.contains("prof-avail")) p.availabilityHours = Math.max(1, Math.min(24, parseNum(target.value) || 24));
    onUpdated();
  };

  tbody.onchange = (e) => {
    const target = e.target as HTMLSelectElement;
    if (target.classList.contains("prof-pool")) {
      const id = target.getAttribute("data-id")!;
      const p = data.professions.find(x => x.id === id);
      if (p) {
        p.pool = target.value as any;
        if (p.pool === "dedicated" && (!p.minCrew || p.minCrew === 0)) p.minCrew = 1;
        onUpdated();
      }
    }
  };

  tbody.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest(".btn-del-prof");
    if (btn) {
      const profId = btn.getAttribute("data-id")!;
      if (data.professions.length <= 1) {
        modalSystem.alert("Внимание", "Справочник должен содержать минимум один технологический участок.");
        return;
      }
      const prof = data.professions.find(p => p.id === profId);
      const normsCount = data.normConfigs ? Object.keys(data.normConfigs).filter(k => k.endsWith("___" + profId)).length : 0;
      modalSystem.confirm(
        "Удаление участка",
        `Удалить участок «${escapeHtml(prof ? prof.name : profId)}»? Будут безвозвратно удалены нормы времени по всем изделиям${normsCount > 0 ? ` и ${normsCount} обоснованных норм в реестре` : ""}.`,
        () => {
          data.professions = data.professions.filter(p => p.id !== profId);
          data.products.forEach(p => { delete p.norms[profId]; });
          if (data.normConfigs) {
            Object.keys(data.normConfigs).forEach(k => { if (k.endsWith("___" + profId)) delete data.normConfigs[k]; });
          }
          onUpdated();
        }
      );
    }
  };

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
    <th class="col-sticky-name" style="min-width: 220px;">Наименование изделия</th>
    <th style="min-width: 90px; text-align: center;">Ед. изм.</th>
    <th style="min-width: 75px; text-align: right;">Брак, %</th>
    ${data.professions.map(prof => `<th style="min-width: 95px; text-align: right;">${escapeHtml(prof.name)}</th>`).join("")}
    <th style="min-width: 90px; text-align: right;">Всего н-ч</th>
    <th style="width: 45px; text-align: center;"></th>
  `;

  tbody.innerHTML = data.products.map((p, idx) => {
    let totalNorm = 0;
    data.professions.forEach(prof => { totalNorm += parseNum(p.norms[prof.id]); });
    const unitList = Array.from(new Set([p.unit || "м²", ...UNIT_PRESETS]));

    return `
      <tr data-index="${idx}">
        <td class="col-drag">
          <span class="drag-handle" title="Перетащите для изменения порядка">
            <svg class="icon"><use href="#icon-grip"></use></svg>
          </span>
        </td>
        <td class="col-sticky-name"><input type="text" class="input-control prod-name" data-id="${p.id}" value="${escapeHtml(p.name)}"></td>
        <td style="text-align: center;">
          <select class="input-control prod-unit" data-id="${p.id}" style="text-align: center; font-weight:600;">
            ${unitList.map(u => `<option value="${escapeHtml(u)}" ${p.unit === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join("")}
          </select>
        </td>
        <td><input type="text" class="input-control input-num prod-scrap" data-id="${p.id}" value="${p.scrap || 0}"></td>
        ${data.professions.map(prof => {
          const normKey = `${p.id}___${prof.id}`;
          const hasConfig = data.normConfigs && data.normConfigs[normKey];
          return `
            <td class="norm-cell-wrap">
              <input type="text" class="input-control input-num prod-norm" data-prod="${p.id}" data-prof="${prof.id}" value="${p.norms[prof.id] !== undefined ? p.norms[prof.id] : 0}">
              <button type="button" class="norm-jump-btn ${hasConfig ? 'has-config' : ''}" data-prod="${p.id}" data-prof="${prof.id}"
                      title="${hasConfig ? 'Норма обоснована расчётом — открыть в калькуляторе' : 'Рассчитать норму через калькулятор нормирования'}">
                <svg class="icon"><use href="#icon-calc"></use></svg>
              </button>
            </td>
          `;
        }).join("")}
        <td style="text-align: right; font-weight: 600;">${totalNorm.toFixed(2)}</td>
        <td style="text-align: center;">
          <button class="btn btn-secondary btn-sm btn-del-prod" data-id="${p.id}" title="Удалить изделие">
            <svg class="icon"><use href="#icon-trash"></use></svg>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.oninput = (e) => {
    const target = e.target as HTMLInputElement;
    const pId = target.getAttribute("data-id") || target.getAttribute("data-prod");
    const product = data.products.find(p => p.id === pId);
    if (!product) return;

    if (target.classList.contains("prod-name")) product.name = target.value;
    else if (target.classList.contains("prod-scrap")) product.scrap = parseNum(target.value);
    else if (target.classList.contains("prod-norm")) {
      const profId = target.getAttribute("data-prof")!;
      product.norms[profId] = parseNum(target.value);
    }
    onUpdated();
  };

  tbody.onchange = (e) => {
    const target = e.target as HTMLSelectElement;
    if (target.classList.contains("prod-unit")) {
      const pId = target.getAttribute("data-id")!;
      const product = data.products.find(p => p.id === pId);
      if (product) {
        product.unit = target.value;
        onUpdated();
      }
    }
  };

  tbody.onclick = (e) => {
    const target = e.target as HTMLElement;
    const jumpBtn = target.closest(".norm-jump-btn");
    const delBtn = target.closest(".btn-del-prod");

    if (jumpBtn) {
      const prodId = jumpBtn.getAttribute("data-prod")!;
      const profId = jumpBtn.getAttribute("data-prof")!;
      onJumpToNorm(prodId, profId);
    } else if (delBtn) {
      const pId = delBtn.getAttribute("data-id")!;
      if (data.products.length <= 1) {
        modalSystem.alert("Внимание", "Справочник должен содержать минимум одно изделие.");
        return;
      }
      const product = data.products.find(p => p.id === pId);
      const normsCount = data.normConfigs ? Object.keys(data.normConfigs).filter(k => k.startsWith(pId + "___")).length : 0;
      modalSystem.confirm(
        "Удаление изделия",
        `Удалить изделие «${escapeHtml(product ? product.name : pId)}»? Будут безвозвратно удалены план выпуска по всем месяцам${normsCount > 0 ? ` и ${normsCount} обоснованных норм в реестре` : ""}.`,
        () => {
          data.products = data.products.filter(p => p.id !== pId);
          delete data.plan[pId];
          if (data.normConfigs) {
            Object.keys(data.normConfigs).forEach(k => { if (k.startsWith(pId + "___")) delete data.normConfigs[k]; });
          }
          onUpdated();
        }
      );
    }
  };

  initTableDragAndDrop("productsTableBody", (fromIdx, toIdx) => {
    const item = data.products.splice(fromIdx, 1)[0];
    data.products.splice(toIdx, 0, item);
    onUpdated();
  });
}
