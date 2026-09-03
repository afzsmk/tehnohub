// src/ui/advisor.ts
import { ScenarioData, CalculationResult } from '../types';

export function renderExecutiveSummary(calc: CalculationResult, data: ScenarioData): void {
  const pillEl = document.getElementById("execStatusPill");
  if (pillEl) {
    const zoneLabels: Record<string, { text: string; cls: string; icon: string }> = {
      green: { text: "Программа выполнима", cls: "status-zone-green", icon: "✓" },
      yellow: { text: "Выполнима с оговорками", cls: "status-zone-yellow", icon: "!" },
      red: { text: "Требует пересмотра", cls: "status-zone-red", icon: "✕" },
      none: { text: "Не определено", cls: "", icon: "—" }
    };
    const z = zoneLabels[calc.overallZone] || zoneLabels.green;
    pillEl.className = `status-pill ${z.cls}`;
    pillEl.textContent = `${z.icon} ${z.text}`;
  }

  const peakStaff = calc.grandTotalStaff.length ? Math.max(...calc.grandTotalStaff) : 0;
  const peakIdx = calc.grandTotalStaff.indexOf(peakStaff);
  const peakValEl = document.getElementById("execPeakValue");
  const peakDescEl = document.getElementById("execPeakDesc");
  if (peakValEl) peakValEl.textContent = `${peakStaff} чел.`;
  if (peakDescEl) peakDescEl.textContent = peakIdx >= 0 ? `Пиковый штат (${data.months[peakIdx]})` : "Пиковая потребность";

  let bottleneckName = "—";
  let bottleneckHours = -1;
  data.professions.forEach(prof => {
    const sumH = calc.hoursByProf[prof.id].reduce((a, b) => a + b, 0);
    if (sumH > bottleneckHours) { bottleneckHours = sumH; bottleneckName = prof.name; }
  });

  const bValEl = document.getElementById("execBottleneckValue");
  if (bValEl) bValEl.textContent = bottleneckName;

  const recEl = document.getElementById("execRecommendationValue");
  if (recEl) {
    recEl.textContent = calc.overallZone === 'red'
      ? "Критический перегруз: используйте «Выровнять план под штат» или увеличьте сменность."
      : calc.overallZone === 'yellow'
      ? "Программа закрывается сверхурочными/удлиненной сменой."
      : "Программа укладывается в номинал без переработок.";
  }
}

export function renderSmartAdvisor(calc: CalculationResult, data: ScenarioData, onLevelClick: (headcount: number) => void): void {
  const listEl = document.getElementById("advisorList");
  const badgeEl = document.getElementById("advisorStatusBadge");
  if (!listEl || !badgeEl) return;

  const items: string[] = [];
  data.months.forEach((m, idx) => {
    const sched = calc.universalSchedules[idx];
    if (sched.statusZone === 'red') {
      items.push(`
        <div class="advisor-item alert-overload" style="display:flex; justify-content:space-between; align-items:center; padding:6px 12px; margin-top:6px; background:#fee2e2; border-radius:6px;">
          <span>В периоде <strong>${m}</strong> дефицит: ${sched.note}</span>
          <button class="btn btn-secondary btn-sm" onclick="window._advisorLevel(${calc.grandTotalStaff[idx]})">Выровнять под ${calc.grandTotalStaff[idx]} чел.</button>
        </div>
      `);
    } else if (sched.statusZone === 'yellow') {
      items.push(`
        <div class="advisor-item alert-overtime" style="padding:6px 12px; margin-top:6px; background:#fef3c7; border-radius:6px;">
          В периоде <strong>${m}</strong> требуется <strong>${sched.mode}</strong>. ${sched.note}
        </div>
      `);
    }
  });

  (window as any)._advisorLevel = onLevelClick;

  if (items.length === 0) {
    badgeEl.textContent = "Баланс оптимален";
    badgeEl.style.color = "var(--success)";
    listEl.innerHTML = `<div style="color:var(--success); padding:8px 0;">✓ Все периоды программы сбалансированы под штат ${calc.totalUniversalHeadcount} чел.</div>`;
  } else {
    badgeEl.textContent = `Замечаний: ${items.length}`;
    badgeEl.style.color = "var(--warning)";
    listEl.innerHTML = items.join("");
  }
}

export function renderDynamicGuides(calc: CalculationResult, data: ScenarioData): void {
  const g1 = document.getElementById("guideTab1Dynamic");
  if (g1) {
    const totalHours = calc.totalHoursByMonth.reduce((a, b) => a + b, 0);
    g1.innerHTML = `
      <div style="padding:10px; background:#fff; border-left:4px solid var(--accent); margin-bottom:8px;">
        <strong>Суммарная трудоёмкость:</strong> ${Math.round(totalHours).toLocaleString()} н-ч по ${data.products.length} позициям на ${data.months.length} мес.
      </div>
    `;
  }
}
