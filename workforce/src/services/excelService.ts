// src/services/excelService.ts
import ExcelJS from 'exceljs';
import { ScenarioData, CalculationResult, AnalysisDisplayMode, WorkforceMode } from '../types';
import { parseNum } from '../core/funds';

export async function exportToExcel(currentScenario: string, data: ScenarioData, calc: CalculationResult, displayMode: AnalysisDisplayMode = 'auto'): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Производственное планирование ЗСМК';
  wb.created = new Date();

  const zoneFill: Record<string, string> = { green: 'FFDCFCE7', yellow: 'FFFEF3C7', red: 'FFFEE2E2' };
  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  const modeLabels: Record<WorkforceMode, string> = { auto: 'Авто', '8h': '8 ч', '12h': '12 ч' };
  const compareLabel = 'Сравнение 8 ч / 12 ч';

  const peak = (values: number[]) => values.length ? Math.max(...values) : 0;
  const avg = (values: number[]) => values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;

  const wsSummary = wb.addWorksheet('Свод');
  wsSummary.columns = [{ width: 34 }, { width: 40 }];
  const company = data.settings.companyName?.trim() || 'Производственная программа';
  wsSummary.mergeCells('A1:B1');
  wsSummary.getCell('A1').value = company;
  wsSummary.getCell('A1').font = { bold: true, size: 15 };
  wsSummary.mergeCells('A2:B2');
  wsSummary.getCell('A2').value = `Сценарий: ${currentScenario}`;
  wsSummary.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } };
  wsSummary.addRow([]);
  wsSummary.addRow(['Текущий вид аналитики', displayMode === 'compare' ? compareLabel : modeLabels[displayMode]]);
  wsSummary.addRow(['Пиковая потребность 8 ч', `${peak(calc.workforceViews['8h'].grandTotalStaff)} чел.`]);
  wsSummary.addRow(['Пиковая потребность 12 ч', `${peak(calc.workforceViews['12h'].grandTotalStaff)} чел.`]);
  wsSummary.addRow(['Пиковая потребность Авто', `${peak(calc.workforceViews.auto.grandTotalStaff)} чел.`]);
  wsSummary.addRow(['Период', `${data.months[0]} — ${data.months[data.months.length - 1]}`]);
  wsSummary.addRow(['Номенклатура', `${data.products.length} поз.`]);
  wsSummary.addRow(['Суммарная трудоёмкость', `${Math.round(calc.totalHoursByMonth.reduce((a: number, b: number) => a + b, 0)).toLocaleString()} н-ч`]);
  const summaryStatus = wsSummary.addRow(['Статус программы', calc.overallZone === 'green' ? 'Программа выполнима' : calc.overallZone === 'yellow' ? 'Выполнима с оговорками' : 'Требует пересмотра']);
  summaryStatus.getCell(1).font = { bold: true };
  if (zoneFill[calc.overallZone]) summaryStatus.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zoneFill[calc.overallZone] } };

  const wsPlan = wb.addWorksheet('План выпуска');
  wsPlan.addRow(['Изделие', 'Ед.', ...data.months, 'Итого']).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsPlan.columns = [{ width: 30 }, { width: 8 }, ...data.months.map(() => ({ width: 12 })), { width: 12 }];
  data.products.forEach(p => {
    const row = data.plan[p.id] || [];
    const total = row.reduce((a, b) => a + parseNum(b), 0);
    wsPlan.addRow([p.name, p.unit || '', ...row.map(v => parseNum(v)), total]);
  });
  wsPlan.getColumn(1).font = { bold: true };

  const wsHours = wb.addWorksheet('Трудоёмкость (н-ч)');
  wsHours.addRow(['Участок', 'Пул', ...data.months, 'Итого']).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsHours.columns = [{ width: 28 }, { width: 14 }, ...data.months.map(() => ({ width: 12 })), { width: 12 }];
  data.professions.forEach(prof => {
    const row = calc.hoursByProf[prof.id];
    const total = row.reduce((a, b) => a + b, 0);
    wsHours.addRow([prof.name, prof.pool === 'universal' ? 'Универсал' : 'Выделенный', ...row.map(h => Math.round(h)), Math.round(total)]);
  });
  const totalHoursRow = wsHours.addRow(['ИТОГО', '', ...calc.totalHoursByMonth.map(h => Math.round(h)), Math.round(calc.totalHoursByMonth.reduce((a, b) => a + b, 0))]);
  totalHoursRow.font = { bold: true };

  function addStaffSheet(mode: WorkforceMode, title: string): void {
    const view = calc.workforceViews[mode];
    const ws = wb.addWorksheet(title);
    ws.addRow([`Потребность в персонале — ${modeLabels[mode]}`, ...data.months]).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
    ws.columns = [{ width: 44 }, ...data.months.map(() => ({ width: 16 }))];
    const regimeRow = ws.addRow(['Режим универсального пула', ...view.universalSchedules.map(sched => sched.mode)]);
    regimeRow.font = { italic: true, color: { argb: 'FF475569' } };
    ws.addRow([`Универсальный пул (${calc.brigadesCount}×${calc.brigadeSize} чел.)`, ...view.universalStaffSpTotal.map(v => Math.round(v * 10) / 10)]);
    calc.universalProfs.forEach(prof => {
      const row = ws.addRow([`↳ ${prof.name}`, ...view.staffByProfSp[prof.id].map(v => Math.round(v * 10) / 10)]);
      row.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
    });
    calc.dedicatedProfs.forEach(prof => {
      const row = ws.addRow([`Выделенный: ${prof.name}`, ...view.staffByProfSp[prof.id].map(v => Math.round(v))]);
      row.font = { color: { argb: 'FF92400E' } };
    });
    ws.addRow(['Вспомогательный персонал', ...view.auxStaffSpTotal.map(v => Math.round(v * 10) / 10)]);
    const totalRow = ws.addRow(['ИТОГО ОБЩИЙ ШТАТ', ...view.grandTotalStaff]);
    totalRow.font = { bold: true };
    totalRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }; });
    ws.addRow([]);
    ws.addRow(['Примечание', 'Выделенные посты: минимум crew×machines сохраняется, при превышении по трудоёмкости добавляются полные сменные звенья.']);
    ws.mergeCells(`B${ws.rowCount}:` + String.fromCharCode(65 + data.months.length) + `${ws.rowCount}`);
  }

  addStaffSheet('auto', 'Штат — Авто');
  addStaffSheet('8h', 'Штат — 8 ч');
  addStaffSheet('12h', 'Штат — 12 ч');

  const wsCompare = wb.addWorksheet('Сравнение 8-12');
  wsCompare.addRow(['Показатель', ...data.months.flatMap(m => [`${m} · 8 ч`, `${m} · 12 ч`])]).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsCompare.columns = [{ width: 42 }, ...data.months.flatMap(() => [{ width: 14 }, { width: 14 }])];
  const v8 = calc.workforceViews['8h'];
  const v12 = calc.workforceViews['12h'];
  wsCompare.addRow(['Универсальный пул, чел.', ...data.months.flatMap((_, i) => [v8.universalStaffSpTotal[i], v12.universalStaffSpTotal[i]])]);
  calc.dedicatedProfs.forEach(prof => wsCompare.addRow([`Выделенный: ${prof.name}, чел.`, ...data.months.flatMap((_, i) => [v8.staffByProfSp[prof.id][i], v12.staffByProfSp[prof.id][i]])]));
  wsCompare.addRow(['Вспомогательный персонал, чел.', ...data.months.flatMap((_, i) => [v8.auxStaffSpTotal[i], v12.auxStaffSpTotal[i]])]);
  const compareTotal = wsCompare.addRow(['ИТОГО ОБЩИЙ ШТАТ, чел.', ...data.months.flatMap((_, i) => [v8.grandTotalStaff[i], v12.grandTotalStaff[i]])]);
  compareTotal.font = { bold: true };
  compareTotal.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }; });

  const wsShift = wb.addWorksheet('Сменность');
  wsShift.addRow(['Участок', ...data.months]).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsShift.columns = [{ width: 30 }, ...data.months.map(() => ({ width: 30 }))];
  data.professions.forEach(prof => {
    const rowVals = calc.profMachineZones[prof.id].map(z => z.plainLabel || 'Простой');
    const row = wsShift.addRow([`${prof.name} (${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'})`, ...rowVals]);
    calc.profMachineZones[prof.id].forEach((z, i) => {
      const cell = row.getCell(i + 2);
      if (zoneFill[z.statusZone]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zoneFill[z.statusZone] } };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Производственная_программа_${currentScenario.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
}
export async function downloadPlanTemplate(currentScenario: string, data: ScenarioData): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("План выпуска");
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  ws.addRow(["Изделие", "Ед. изм.", ...data.months]).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  ws.columns = [{ width: 34 }, { width: 10 }, ...data.months.map(() => ({ width: 14 }))];

  data.products.forEach(p => {
    const row = data.plan[p.id] || new Array(data.months.length).fill(0);
    ws.addRow([p.name, p.unit || "", ...row.map(v => parseNum(v))]);
  });
  ws.getColumn(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Шаблон_плана_${currentScenario.replace(/\s+/g, "_")}.xlsx`;
  link.click();
}

export async function parsePlanExcel(file: File, data: ScenarioData): Promise<{ updatedCells: number; matchedRows: number; unmatchedNames: string[] }> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("В файле не найден ни один лист.");

  const headerRow = ws.getRow(1);
  const monthColByName: Record<string, number> = {};
  for (let col = 3; col <= ws.columnCount; col++) {
    const raw = headerRow.getCell(col).value;
    const name = raw ? String(raw).trim() : "";
    if (name) monthColByName[name] = col;
  }

  const productIdByName: Record<string, string> = {};
  data.products.forEach(p => { productIdByName[p.name.trim()] = p.id; });

  let matchedRows = 0;
  let updatedCells = 0;
  const unmatchedNames: string[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = row.getCell(1).value;
    const name = rawName ? String(rawName).trim() : "";
    if (!name) continue;

    const prodId = productIdByName[name];
    if (!prodId) { unmatchedNames.push(name); continue; }
    matchedRows++;

    if (!data.plan[prodId]) data.plan[prodId] = new Array(data.months.length).fill(0);
    data.months.forEach((m, idx) => {
      const col = monthColByName[m];
      if (col === undefined) return;
      const cellVal = row.getCell(col).value;
      if (cellVal === null || cellVal === undefined || cellVal === "") return;
      data.plan[prodId][idx] = parseNum(cellVal);
      updatedCells++;
    });
  }

  return { updatedCells, matchedRows, unmatchedNames };
}