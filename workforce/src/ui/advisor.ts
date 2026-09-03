// src/ui/advisor.ts
import { ScenarioData, CalculationResult } from '../types';

function escapeHtml(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
      ? "Критический дефицит мощности: используйте «Выровнять план под штат» или увеличьте сменность."
      : calc.overallZone === 'yellow'
      ? "Отдельные периоды загружены сверх номинала и закрываются сверхурочными/2-сменным режимом."
      : "Программа укладывается в номинальную мощность бригад и оборудования без сверхурочных.";
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
    `<strong>Диапазон потребности в штате:</strong> от <strong>${minStaff} чел.</strong> (${escapeHtml(minMonth)}) до <strong>${maxStaff} чел.</strong> (${escapeHtml(maxMonth)}) — колебание ${maxStaff - minStaff} чел. из-за неравномерности плана.`,
    `<strong>Универсальный пул:</strong> объединяет <strong>${calc.universalProfs.length} постов</strong> и берёт на себя <strong>${universalShare}%</strong> всей программы. Доступно <strong>${calc.brigadesCount} бриг.</strong> по <strong>${calc.brigadeSize} чел.</strong> (всего ${calc.totalUniversalHeadcount} универсалов).`,
    `<strong>Лимитирующий технологический участок:</strong> «<strong>${escapeHtml(maxProfName) || '—'}</strong>» забирает <strong>${bottleneckShare}%</strong> всей трудоёмкости (${Math.round(maxProfHours).toLocaleString()} н-ч).`
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
          <strong>Период: ${escapeHtml(m)}</strong>
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
          <span>В периоде <strong>${escapeHtml(m)}</strong> дефицит: ${sched.note}</span>
          <button class="btn btn-secondary btn-sm" onclick="window._advisorLevel(${calc.grandTotalStaff[idx]})">Выровнять под ${calc.grandTotalStaff[idx]} чел.</button>
        </div>
      `);
    } else if (sched.statusZone === 'yellow') {
      items.push(`
        <div class="advisor-item alert-overtime" style="padding:6px 12px; margin-top:6px; background:#fef3c7; border-radius:6px;">
          В периоде <strong>${escapeHtml(m)}</strong> требуется <strong>${sched.mode}</strong>. ${sched.note}
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

  // Справка Вкладка 1
  const g1 = document.getElementById("guideTab1Dynamic");
  if (g1) {
    g1.innerHTML = `
      <div class="method-item">
        <div class="method-item-title">1. Назначение плана выпуска</div>
        <div class="method-item-desc">В этой таблице задаются помесячные объёмы готовой продукции. Система непрерывно рассчитывает общую трудоёмкость (<strong>${Math.round(totalHours).toLocaleString()} н-ч</strong>) по <strong>${data.products.length} позициям</strong> номенклатуры на горизонте <strong>${data.months.length} мес.</strong></div>
      </div>
      <div class="method-item">
        <div class="method-item-title">2. Как сроки влияют на штат</div>
        <div class="method-item-desc">При неравномерном распределении заказов возникают пики потребности (пик: <strong>${Math.max(...calc.grandTotalStaff)} чел.</strong> при среднем <strong>${(calc.grandTotalStaff.reduce((a,b)=>a+b,0)/calc.grandTotalStaff.length).toFixed(1)} чел.</strong>). Сгладить перепады позволяет кнопка «Выровнять план под штат».</div>
      </div>
    `;
  }

  // Справка Вкладка 2 (Все 3 пункта!)
  const g2 = document.getElementById("guideTab2Dynamic");
  if (g2) {
    const uHoursSum = calc.universalHoursTotal.reduce((a, b) => a + b, 0);
    g2.innerHTML = `
      <div class="method-item" style="border-left-color:#2563eb; background:#eff6ff;">
        <div class="method-item-title" style="color:#1e40af;">1. Текущий баланс универсального пула</div>
        <div class="method-item-desc">В универсальный пул входит <strong>${calc.universalProfs.length} постов</strong> с общей трудоёмкостью <strong>${Math.round(uHoursSum).toLocaleString()} н-ч</strong> (${totalHours > 0 ? Math.round((uHoursSum / totalHours) * 100) : 0}% программы). Доступно <strong>${calc.brigadesCount} бригад(ы)</strong> по <strong>${calc.brigadeSize} чел.</strong> (активный штат: <strong>${calc.totalUniversalHeadcount} чел.</strong>).</div>
      </div>
      <div class="method-item">
        <div class="method-item-title">2. Выделенные стационарные посты</div>
        <div class="method-item-desc">К выделенным отнесено <strong>${calc.dedicatedProfs.length} постов</strong> (${calc.dedicatedProfs.map(p=>escapeHtml(p.name)).join(', ') || 'нет'}), где операторы не ротируются.</div>
      </div>
      <div class="method-item">
        <div class="method-item-title">3. Формула располагаемого фонда времени</div>
        <div class="method-item-formula">Ёмкость пула (${calc.shiftHoursStandard}ч/5-2) = ${calc.totalUniversalHeadcount} чел × ${calc.fEff}ч × ${calc.kVn} = ${calc.poolCapacityNormal.toFixed(1)} н-ч/мес</div>
        <div class="method-item-desc">При переходе всех универсалов на усиленный режим (${calc.extendedShiftHours}ч/5-2): <strong>${(calc.totalUniversalHeadcount * calc.fEffExtended * calc.kVn).toFixed(1)} н-ч/мес</strong>. Сверхурочные применяются только поверх обычной ${calc.shiftHoursStandard}ч-смены (до +${calc.maxOvertimePct}%). Жёсткий потолок рекомендаций смены — ${calc.hardShiftCeiling}ч.</div>
      </div>
    `;
  }

  // Справка Вкладка 3
  const g3 = document.getElementById("guideTab3Dynamic");
  if (g3) {
    g3.innerHTML = `
      <div class="method-item">
        <div class="method-item-title">1. Сменно-статистический расчёт</div>
        <div class="method-item-formula">Норма = (Nраб × (Смена - Перерывы/60) × Kэф) / Q</div>
        <div class="method-item-desc">Автоматически вычисляет фактическую норму по сдаче партии за смену и привязывает параметры к выбранной паре «Изделие + Участок».</div>
      </div>
      <div class="method-item">
        <div class="method-item-title">2. Поэлементный хронометраж</div>
        <div class="method-item-formula">Tшт = ((Tосн + Tвсп) × (1 + (Kобс + Kотд)/100) + Tпз/50) × Звено / 60</div>
        <div class="method-item-desc">Инженерный расчёт штучного времени по секундомеру с учётом подготовительно-заключительного времени и размера звена.</div>
      </div>
    `;
  }

  // Справка Вкладка 4 (Аналитика)
  const g4 = document.getElementById("guideTab4Dynamic");
  if (g4) {
    g4.innerHTML = `
      <div class="method-item" style="border-left-color:#2563eb; background:#eff6ff;">
        <div class="method-item-title" style="color:#1e40af;">Шаг 1. Зоны загрузки универсального пула</div>
        <div class="method-item-desc">
          Все ${calc.totalUniversalHeadcount} универсалов работают одновременно на 5/2:<br>
          • <strong>Зелёная зона (до ${calc.poolCapacityNormal.toFixed(0)} н-ч):</strong> обычная смена ${calc.shiftHoursStandard}ч.<br>
          • <strong>Жёлтая зона, сверхурочные (до ${calc.poolCapacityNormalOT.toFixed(0)} н-ч):</strong> закрывается разовыми переработками (до +${calc.maxOvertimePct}%).<br>
          • <strong>Жёлтая зона, удлинённая смена (до ${calc.poolCapacityCeiling.toFixed(0)} н-ч):</strong> смена длиннее (до ${calc.hardShiftCeiling}ч, шаг 0.5ч).<br>
          • <strong>Красная зона (выше ${calc.poolCapacityCeiling.toFixed(0)} н-ч):</strong> дефицит — требуется дополнительный штат или выравнивание плана.
        </div>
      </div>
      <div class="method-item">
        <div class="method-item-title">Шаг 2. Расчёт штата и пиковых нагрузок</div>
        <div class="method-item-formula">Штат = Трудоёмкость / (${calc.fEff}ч × ${calc.kVn})</div>
        <div class="method-item-desc">Один рабочий вырабатывает <strong>${(calc.fEff * calc.kVn).toFixed(1)} н-ч/мес</strong>. Пиковая нагрузка завода: <strong>${Math.max(...calc.grandTotalStaff)} чел.</strong>, средняя: <strong>${(calc.grandTotalStaff.reduce((a,b)=>a+b,0)/calc.grandTotalStaff.length).toFixed(1)} чел.</strong></div>
      </div>
    `;
  }
}
