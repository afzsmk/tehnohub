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

export function renderSummaryBullets(calc: CalculationResult, data: ScenarioData): void {
  const summaryList = document.getElementById("summaryBulletPoints");
  if (!summaryList) return;

  let maxStaff = -1, minStaff = Infinity;
  let maxMonth = "", minMonth = "";
  calc.grandTotalStaff.forEach((st, idx) => {
    if (st > maxStaff) { maxStaff = st; maxMonth = data.months[idx]; }
    if (st < minStaff) { minStaff = st; minMonth = data.months[idx]; }
  });

  let maxProfName = "", maxProfHours = -1;
  data.professions.forEach(prof => {
    const sumH = calc.hoursByProf[prof.id].reduce((a, b) => a + b, 0);
    if (sumH > maxProfHours) { maxProfHours = sumH; maxProfName = prof.name; }
  });

  const totalPlanHours = calc.totalHoursByMonth.reduce((a, b) => a + b, 0);
  const bottleneckShare = totalPlanHours > 0 ? ((maxProfHours / totalPlanHours) * 100).toFixed(1) : "0";
  const universalShare = totalPlanHours > 0 ? ((calc.universalHoursTotal.reduce((a, b) => a + b, 0) / totalPlanHours) * 100).toFixed(1) : "0";

  const bullets = [
    `<strong>Диапазон потребности в штате:</strong> от <strong>${minStaff} чел.</strong> (${minMonth}) до <strong>${maxStaff} чел.</strong> (${maxMonth}) — колебание ${maxStaff - minStaff} чел. из-за неравномерности плана.`,
    `<strong>Универсальный пул:</strong> объединяет <strong>${calc.universalProfs.length} постов</strong> и берёт на себя <strong>${universalShare}%</strong> всей программы. Доступно <strong>${calc.brigadesCount} бриг.</strong> по <strong>${calc.brigadeSize} чел.</strong> (всего ${calc.totalUniversalHeadcount} универсалов).`,
    `<strong>Лимитирующий технологический участок:</strong> «<strong>${maxProfName || '—'}</strong>» забирает <strong>${bottleneckShare}%</strong> всей трудоёмкости (${Math.round(maxProfHours).toLocaleString()} н-ч).`
  ];

  summaryList.innerHTML = bullets.map(b => `<li>${b}</li>`).join("");
}

export function renderBrigadeSchedule(calc: CalculationResult, data: ScenarioData, onApplyShift: (shiftHours: number) => void): void {
  const txtCount = document.getElementById("txtBrigadesCount");
  const txtSize = document.getElementById("txtBrigadeSize");
  if (txtCount) txtCount.textContent = String(calc.brigadesCount);
  if (txtSize) txtSize.textContent = String(calc.brigadeSize);

  const container = document.getElementById("brigadeScheduleDetails");
  if (!container) return;

  (window as any)._applyShiftFromBrigade = onApplyShift;

  let html = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:10px;">`;
  data.months.forEach((m, idx) => {
    const sched = calc.universalSchedules[idx];
    const uHrs = Math.round(calc.universalHoursTotal[idx]);
    const loadPct = Math.round((calc.universalHoursTotal[idx] / calc.poolCapacityNormal) * 100);

    html += `
      <div style="background:#f8fafc; border:1px solid var(--border-color); border-radius:6px; padding:8px 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong>Период: ${m}</strong>
          <span class="${sched.badgeClass}">${sched.mode}</span>
        </div>
        <div>Трудоёмкость универсалов: <strong>${uHrs} н-ч</strong> (${loadPct}% от нормы ${calc.shiftHoursStandard}ч/5-2)</div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${sched.note}</div>
        ${sched.canApplyShift !== null ? `<button type="button" class="btn btn-secondary btn-sm" onclick="window._applyShiftFromBrigade(${sched.canApplyShift})" style="margin-top:8px;">Применить ${sched.canApplyShift}ч как усиленный режим</button>` : ""}
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
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
  const totalHours = calc.totalHoursByMonth.reduce((a, b) => a + b, 0);

  const g1 = document.getElementById("guideTab1Dynamic");
  if (g1) {
    g1.innerHTML = `
      <div class="method-item">
        <div class="method-item-title">1. Назначение плана выпуска</div>
        <div class="method-item-desc">В этой таблице задаются помесячные объёмы. Система непрерывно рассчитывает общую трудоёмкость (<strong>${Math.round(totalHours).toLocaleString()} н-ч</strong>) по <strong>${data.products.length} позициям</strong> номенклатуры на горизонте <strong>${data.months.length} мес.</strong></div>
      </div>
      <div class="method-item">
        <div class="method-item-title">2. Как сроки влияют на штат</div>
        <div class="method-item-desc">Сгладить перепады потребности позволяет кнопка «Выровнять план под штат».</div>
      </div>
    `;
  }

  const g2 = document.getElementById("guideTab2Dynamic");
  if (g2) {
    const uHoursSum = calc.universalHoursTotal.reduce((a, b) => a + b, 0);
    g2.innerHTML = `
      <div class="method-item" style="border-left-color:#2563eb; background:#eff6ff;">
        <div class="method-item-title" style="color:#1e40af;">1. Баланс универсального пула</div>
        <div class="method-item-desc">В универсальный пул входит <strong>${calc.universalProfs.length} постов</strong> с общей трудоёмкостью <strong>${Math.round(uHoursSum).toLocaleString()} н-ч</strong> (${totalHours > 0 ? Math.round((uHoursSum / totalHours) * 100) : 0}% программы). Доступно <strong>${calc.brigadesCount} бриг.</strong> по <strong>${calc.brigadeSize} чел.</strong> (${calc.totalUniversalHeadcount} чел.).</div>
      </div>
      <div class="method-item">
        <div class="method-item-title">2. Выделенные стационарные посты</div>
        <div class="method-item-desc">К выделенным отнесено <strong>${calc.dedicatedProfs.length} постов</strong>, где операторы не ротируются.</div>
      </div>
    `;
  }

  const g3 = document.getElementById("guideTab3Dynamic");
  if (g3) {
    g3.innerHTML = `
      <div class="method-item">
        <div class="method-item-title">1. Сменно-статистический расчёт</div>
        <div class="method-item-formula">Норма = (Nраб × (Смена - Перерывы/60) × Kэф) / Q</div>
      </div>
      <div class="method-item">
        <div class="method-item-title">2. Поэлементный хронометраж</div>
        <div class="method-item-formula">Tшт = ((Tосн + Tвсп) × (1 + (Kобс + Kотд)/100) + Tпз/50) × Звено / 60</div>
      </div>
    `;
  }
}
