// src/services/excelService.ts
import ExcelJS from 'exceljs';
import { ScenarioData, CalculationResult } from '../types';
import { parseNum } from '../core/funds';

export async function exportToExcel(currentScenario: string, data: ScenarioData, calc: CalculationResult): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Производственное планирование ЗСМК";
  wb.created = new Date();

  const zoneFill: Record<string, string> = { green: "FFDCFCE7", yellow: "FFFEF3C7", red: "FFFEE2E2" };
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  // 1. Сводный лист
  const wsSummary = wb.addWorksheet("Свод");
  wsSummary.columns = [{ width: 34 }, { width: 34 }];
  const company = data.settings.companyName?.trim() || "Производственная программа";
  wsSummary.mergeCells("A1:B1");
  wsSummary.getCell("A1").value = company;
  wsSummary.getCell("A1").font = { bold: true, size: 15 };
  wsSummary.mergeCells("A2:B2");
  wsSummary.getCell("A2").value = `Сценарий: ${currentScenario}`;
  wsSummary.getCell("A2").font = { italic: true, color: { argb: "FF64748B" } };
  wsSummary.addRow([]);

  const zoneLabels: Record<string, string> = {
    green: "Программа выполнима",
    yellow: "Выполнима с оговорками",
    red: "Требует пересмотра"
  };

  const peakStaff = calc.grandTotalStaff.length ? Math.max(...calc.grandTotalStaff) : 0;
  const peakIdx = calc.grandTotalStaff.indexOf(peakStaff);

  let bottleneckName = "—";
  let bottleneckHours = -1;
  data.professions.forEach(prof => {
    const sumH = calc.hoursByProf[prof.id].reduce((a, b) => a + b, 0);
    if (sumH > bottleneckHours) { bottleneckHours = sumH; bottleneckName = prof.name; }
  });

  const summaryRows = [
    ["Статус программы", zoneLabels[calc.overallZone] || ""],
    ["Период", `${data.months[0]} — ${data.months[data.months.length - 1]}`],
    ["Номенклатура", `${data.products.length} поз.`],
    ["Суммарная трудоёмкость", `${Math.round(calc.totalHoursByMonth.reduce((a, b) => a + b, 0)).toLocaleString()} н-ч`],
    ["Пиковый штат", `${peakStaff} чел.${peakIdx >= 0 ? ` (${data.months[peakIdx]})` : ""}`],
    ["Узкое место программы", bottleneckName],
    ["Дата формирования", new Date().toLocaleString("ru-RU")]
  ];

  summaryRows.forEach(r => {
    const row = wsSummary.addRow(r);
    row.getCell(1).font = { bold: true };
  });

  const statusRow = wsSummary.getRow(4);
  if (zoneFill[calc.overallZone]) {
    statusRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: zoneFill[calc.overallZone] } };
  }

  // 2. План выпуска
  const wsPlan = wb.addWorksheet("План выпуска");
  const planHeader = ["Изделие", "Ед.", ...data.months, "Итого"];
  wsPlan.addRow(planHeader).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsPlan.columns = [{ width: 30 }, { width: 8 }, ...data.months.map(() => ({ width: 12 })), { width: 12 }];

  data.products.forEach(p => {
    const row = data.plan[p.id] || [];
    const total = row.reduce((a, b) => a + parseNum(b), 0);
    wsPlan.addRow([p.name, p.unit || "", ...row.map(v => parseNum(v)), total]);
  });
  wsPlan.getColumn(1).font = { bold: true };

  // 3. Трудоёмкость
  const wsHours = wb.addWorksheet("Трудоёмкость (н-ч)");
  wsHours.addRow(["Участок", "Пул", ...data.months, "Итого"]).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsHours.columns = [{ width: 28 }, { width: 14 }, ...data.months.map(() => ({ width: 12 })), { width: 12 }];
  data.professions.forEach(prof => {
    const row = calc.hoursByProf[prof.id];
    const total = row.reduce((a, b) => a + b, 0);
    wsHours.addRow([prof.name, prof.pool === "universal" ? "Универсал" : "Выделенный", ...row.map(h => Math.round(h)), Math.round(total)]);
  });
  const totalHoursRow = wsHours.addRow(["ИТОГО", "", ...calc.totalHoursByMonth.map(h => Math.round(h)), Math.round(calc.totalHoursByMonth.reduce((a, b) => a + b, 0))]);
  totalHoursRow.font = { bold: true };

  // 4. Штат
  const wsStaff = wb.addWorksheet("Штат по пулам");
  wsStaff.addRow(["Пул / показатель", ...data.months]).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsStaff.columns = [{ width: 32 }, ...data.months.map(() => ({ width: 12 }))];
  wsStaff.addRow([`Универсальный пул (${calc.brigadesCount}×${calc.brigadeSize} чел.)`, ...calc.universalStaffSpTotal.map(v => Math.round(v * 10) / 10)]);

  calc.universalProfs.forEach(prof => {
    const row = wsStaff.addRow([`↳ ${prof.name}`, ...calc.staffByProfSp[prof.id].map(v => Math.round(v * 10) / 10)]);
    row.getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
  });

  calc.dedicatedProfs.forEach(prof => {
    wsStaff.addRow([`↳ ${prof.name} (выделенный)`, ...calc.staffByProfSp[prof.id].map(v => Math.round(v * 10) / 10)]);
  });

  wsStaff.addRow(["Вспомогательный персонал", ...calc.auxStaffSpTotal.map(v => Math.round(v * 10) / 10)]);
  const grandRow = wsStaff.addRow(["ИТОГО ШТАТ", ...calc.grandTotalStaff]);
  grandRow.font = { bold: true };
  grandRow.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } }; });

  // 5. Сменность
  const wsShift = wb.addWorksheet("Сменность");
  wsShift.addRow(["Участок", ...data.months]).eachCell(c => { c.font = { bold: true }; c.fill = headerFill; });
  wsShift.columns = [{ width: 28 }, ...data.months.map(() => ({ width: 20 }))];
  data.professions.forEach(prof => {
    const rowVals = calc.profMachineZones[prof.id].map(z => z.plainLabel || "Простой");
    const row = wsShift.addRow([`${prof.name} (${prof.pool === 'universal' ? 'Универсал' : 'Выделенный'})`, ...rowVals]);
    calc.profMachineZones[prof.id].forEach((z, i) => {
      const cell = row.getCell(i + 2);
      if (zoneFill[z.statusZone]) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zoneFill[z.statusZone] } };
    });
  });

  // Скачивание файла
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Производственная_программа_${currentScenario.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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