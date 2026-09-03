// src/ui/tables/planTable.ts
import { ScenarioData, CalculationResult } from '../../types';
import { parseNum } from '../../core/funds';
import { modalSystem } from '../modal';

export function renderPlanTable(
  data: ScenarioData,
  calc: CalculationResult,
  onCellChange: (prodId: string, monthIdx: number, val: number) => void,
  onMonthRename: (monthIdx: number, newName: string) => void
): void {
  const headerRow = document.getElementById("planTableHeader");
  const tbody = document.getElementById("planTableBody");
  const tfoot = document.getElementById("planTableFooter");
  if (!headerRow || !tbody || !tfoot) return;

  headerRow.innerHTML = `
    <th class="col-sticky-name" style="min-width: 240px; vertical-align: bottom;">Наименование продукции</th>
    <th style="width: 75px; text-align: center; vertical-align: bottom;">Ед. изм.</th>
    ${data.months.map((m, idx) => `
      <th style="min-width: 110px; text-align: center; vertical-align: top; padding: 6px;">
        <div class="col-header-tools" style="display:flex; justify-content:center; gap:4px; margin-bottom:4px;">
          <button class="col-tool-btn btn-move-left" data-idx="${idx}" title="Сдвинуть влево" ${idx === 0 ? 'disabled' : ''}>◀</button>
          <button class="col-tool-btn btn-del-month" data-idx="${idx}" title="Удалить месяц">✕</button>
          <button class="col-tool-btn btn-move-right" data-idx="${idx}" title="Сдвинуть вправо" ${idx === data.months.length - 1 ? 'disabled' : ''}>▶</button>
        </div>
        <input type="text" class="input-control month-name-input" value="${m}" data-month-idx="${idx}" style="font-weight: 700; text-align: center; padding: 2px;">
      </th>
    `).join("")}
    <th style="min-width: 120px; text-align: right; vertical-align: bottom;">Итого выпуск</th>
  `;

  tbody.innerHTML = data.products.map(p => {
    const rowData = data.plan[p.id] || new Array(data.months.length).fill(0);
    const rowSum = rowData.reduce((sum, v) => sum + parseNum(v), 0);
    return `
      <tr>
        <td class="col-sticky-name"><strong>${p.name}</strong></td>
        <td style="text-align: center;"><span class="badge-unit">${p.unit || 'м²'}</span></td>
        ${data.months.map((_, mIdx) => `
          <td>
            <input type="text" class="input-control input-num plan-input"
                   data-product-id="${p.id}" data-month-idx="${mIdx}" value="${rowData[mIdx] ?? 0}">
          </td>
        `).join("")}
        <td style="text-align: right; font-weight: 600;">${rowSum.toLocaleString()} ${p.unit || 'м²'}</td>
      </tr>
    `;
  }).join("");

  const grandTotalHours = calc.totalHoursByMonth.reduce((a, b) => a + b, 0);
  tfoot.innerHTML = `
    <tr>
      <td class="col-sticky-name" colspan="2">ИТОГО ТРУДОЁМКОСТЬ (н-ч):</td>
      ${calc.totalHoursByMonth.map(mHours => `<td style="text-align: right; font-weight:700;">${Math.round(mHours).toLocaleString()}</td>`).join("")}
      <td style="text-align: right; font-weight: 700; color:var(--accent);">${Math.round(grandTotalHours).toLocaleString()} н-ч</td>
    </tr>
  `;

  // Обработчик быстрых правок
  tbody.oninput = (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains("plan-input")) {
      const pId = target.getAttribute("data-product-id")!;
      const mIdx = parseInt(target.getAttribute("data-month-idx")!);
      onCellChange(pId, mIdx, parseNum(target.value));
    }
  };

  headerRow.onchange = (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains("month-name-input")) {
      const mIdx = parseInt(target.getAttribute("data-month-idx")!);
      onMonthRename(mIdx, target.value.trim() || `М ${mIdx + 1}`);
    }
  };
}

/**
 * Обработка вставки диапазона из буфера обмена (Ctrl + V)
 */
export function attachPlanPasteHandler(data: ScenarioData, onPlanUpdated: () => void): void {
  const table = document.getElementById("planTable");
  if (!table) return;

  table.addEventListener("paste", (e: ClipboardEvent) => {
    const target = e.target as HTMLInputElement;
    if (!target || !target.classList.contains("plan-input")) return;

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;
    const text = clipboardData.getData("text");
    if (!text) return;

    const rows = text.replace(/\r/g, "").split("\n")
      .filter((r, i, arr) => !(i === arr.length - 1 && r === ""))
      .map(r => r.split("\t"));
    if (rows.length === 0) return;

    e.preventDefault();

    const startProdId = target.getAttribute("data-product-id");
    const startMonthIdx = parseInt(target.getAttribute("data-month-idx") || "0");
    const startProdIdx = data.products.findIndex(p => p.id === startProdId);
    if (startProdIdx === -1) return;

    let pastedCount = 0;
    let skippedCount = 0;

    rows.forEach((rowCells, r) => {
      const prodIdx = startProdIdx + r;
      if (prodIdx >= data.products.length) { skippedCount += rowCells.length; return; }
      const prod = data.products[prodIdx];
      if (!data.plan[prod.id]) data.plan[prod.id] = new Array(data.months.length).fill(0);

      rowCells.forEach((cellVal, c) => {
        const monthIdx = startMonthIdx + c;
        if (monthIdx >= data.months.length) { skippedCount++; return; }
        const trimmed = cellVal.trim();
        if (trimmed === "") return;
        data.plan[prod.id][monthIdx] = parseNum(trimmed);
        pastedCount++;
      });
    });

    onPlanUpdated();

    if (skippedCount > 0) {
      modalSystem.alert("Вставка выполнена частично", `Вставлено значений: ${pastedCount}. Пропущено: ${skippedCount} (выходят за границы таблицы).`);
    }
  });
}
