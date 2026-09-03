// src/ui/tables/planTable.ts
import { ScenarioData, CalculationResult } from '../../types';
import { parseNum } from '../../core/funds';
import { modalSystem } from '../modal';

function escapeHtml(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderPlanTable(
  data: ScenarioData,
  calc: CalculationResult,
  onCellChange: (prodId: string, monthIdx: number, val: number) => void,
  onMonthRename: (monthIdx: number, newName: string) => void,
  onMoveMonth: (fromIdx: number, toIdx: number) => void,
  onDeleteMonth: (idx: number) => void
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
        <div class="col-header-tools">
          <button class="col-tool-btn btn-move-left" data-idx="${idx}" title="Сдвинуть месяц влево" ${idx === 0 ? 'disabled' : ''}>
            <svg class="icon icon-sm"><use href="#icon-arrow-left"></use></svg>
          </button>
          <button class="col-tool-btn btn-del-month" data-idx="${idx}" title="Удалить месяц">
            <svg class="icon icon-sm"><use href="#icon-x"></use></svg>
          </button>
          <button class="col-tool-btn btn-move-right" data-idx="${idx}" title="Сдвинуть месяц вправо" ${idx === data.months.length - 1 ? 'disabled' : ''}>
            <svg class="icon icon-sm"><use href="#icon-arrow-right"></use></svg>
          </button>
        </div>
        <input type="text" class="input-control month-name-input" value="${escapeHtml(m)}" data-month-idx="${idx}" style="font-weight: 700; text-align: center; padding: 3px 4px; font-size: 12.5px;">
      </th>
    `).join("")}
    <th style="min-width: 120px; text-align: right; vertical-align: bottom;">Итого выпуск</th>
  `;

  tbody.innerHTML = data.products.map(p => {
    const rowData = data.plan[p.id] || new Array(data.months.length).fill(0);
    const rowSum = rowData.reduce((sum, v) => sum + parseNum(v), 0);
    const unitLabel = p.unit || "м²";

    return `
      <tr>
        <td class="col-sticky-name"><strong>${escapeHtml(p.name)}</strong></td>
        <td style="text-align: center;"><span class="badge-unit">${escapeHtml(unitLabel)}</span></td>
        ${data.months.map((_, mIdx) => `
          <td>
            <input type="text" class="input-control input-num plan-input"
                   data-product-id="${p.id}" data-month-idx="${mIdx}" value="${rowData[mIdx] !== undefined ? rowData[mIdx] : 0}">
          </td>
        `).join("")}
        <td style="text-align: right; font-weight: 600;">${rowSum.toLocaleString()} ${escapeHtml(unitLabel)}</td>
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

  // ТОЧЕЧНЫЙ ВВОД БЕЗ ПОТЕРИ ФОКУСА
  tbody.oninput = (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains("plan-input")) {
      const pId = target.getAttribute("data-product-id")!;
      const mIdx = parseInt(target.getAttribute("data-month-idx")!);
      const val = parseNum(target.value);
      onCellChange(pId, mIdx, val);

      // Локально обновляем сумму строки
      const tr = target.closest("tr");
      if (tr && data.plan[pId]) {
        const sum = data.plan[pId].reduce((s, v) => s + parseNum(v), 0);
        const pObj = data.products.find(x => x.id === pId);
        const lastTd = tr.querySelector("td:last-child");
        if (lastTd) lastTd.textContent = `${sum.toLocaleString()} ${pObj?.unit || 'м²'}`;
      }
    }
  };

  headerRow.oninput = (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains("month-name-input")) {
      const mIdx = parseInt(target.getAttribute("data-month-idx")!);
      onMonthRename(mIdx, target.value.trim() || `М ${mIdx + 1}`);
    }
  };

  headerRow.onclick = (e) => {
    const target = e.target as HTMLElement;
    const btnLeft = target.closest(".btn-move-left");
    const btnRight = target.closest(".btn-move-right");
    const btnDel = target.closest(".btn-del-month");

    if (btnLeft) {
      const idx = parseInt(btnLeft.getAttribute("data-idx")!);
      if (idx > 0) onMoveMonth(idx, idx - 1);
    } else if (btnRight) {
      const idx = parseInt(btnRight.getAttribute("data-idx")!);
      if (idx < data.months.length - 1) onMoveMonth(idx, idx + 1);
    } else if (btnDel) {
      const idx = parseInt(btnDel.getAttribute("data-idx")!);
      if (data.months.length <= 1) {
        modalSystem.alert("Внимание", "План должен содержать минимум один месяц.");
        return;
      }
      modalSystem.confirm("Удаление периода", `Удалить период «${data.months[idx]}» вместе со всеми объёмами выпуска?`, () => {
        onDeleteMonth(idx);
      });
    }
  };
}

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
