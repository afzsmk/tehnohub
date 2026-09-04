export function renderSmartAdvisor(calc: CalculationResult, data: ScenarioData, onLevelClick: (headcount: number) => void): void {
  const listEl = document.getElementById("advisorList");
  const badgeEl = document.getElementById("advisorStatusBadge");
  if (!listEl || !badgeEl) return;

  const items: string[] = [];
  data.months.forEach((m, idx) => {
    const uHrs = calc.universalHoursTotal[idx];
    const sched = calc.universalSchedules[idx];

    if (sched.statusZone === 'red') {
      items.push(`
        <div class="advisor-item alert-overload" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; margin-top:6px; background:#fee2e2; border-radius:6px; border:1px solid #fca5a5; color:#991b1b;">
          <span>В периоде <strong>${escapeHtml(m)}</strong> дефицит: ${sched.note}</span>
          <button class="btn btn-secondary btn-sm" onclick="window._advisorLevel(${calc.grandTotalStaff[idx]})">Выровнять под ${calc.grandTotalStaff[idx]} чел.</button>
        </div>
      `);
    } else if (sched.statusZone === 'yellow') {
      items.push(`
        <div class="advisor-item alert-overtime" style="padding:8px 12px; margin-top:6px; background:#fef3c7; border-radius:6px; border:1px solid #fde68a; color:#92400e;">
          В периоде <strong>${escapeHtml(m)}</strong> требуется <strong>${escapeHtml(sched.mode)}</strong>. ${escapeHtml(sched.note)}
        </div>
      `);
    // ВОССТАНОВЛЕНА КАРТОЧКА НЕДОЗАГРУЗКИ < 50%
    } else if (uHrs < calc.poolCapacityNormal * 0.5 && uHrs > 0) {
      const underPct = Math.round(((calc.poolCapacityNormal - uHrs) / calc.poolCapacityNormal) * 100);
      items.push(`
        <div class="advisor-item alert-underload" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; margin-top:6px; background:#e0f2fe; border-radius:6px; border:1px solid #bae6fd; color:#0369a1;">
          <span>В периоде <strong>${escapeHtml(m)}</strong> недозагрузка универсалов <strong>${underPct}%</strong> (объём всего ${Math.round(uHrs)} н-ч).</span>
          <button class="btn btn-secondary btn-sm" onclick="modalSystem.alert('Рекомендация', 'В период ${escapeHtml(m)} рекомендуется задействовать свободные бригады на опережающую заготовку панелей.')">Направить на опережение</button>
        </div>
      `);
    }
  });

  (window as any)._advisorLevel = onLevelClick;

  if (items.length === 0) {
    badgeEl.textContent = "Баланс оптимален";
    badgeEl.style.color = "var(--success)";
    listEl.innerHTML = `<div class="advisor-item alert-optimal" style="background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; padding:8px 12px; border-radius:6px;">✅ Все периоды производственной программы сбалансированы и укладываются в ёмкость персонала (${calc.totalUniversalHeadcount} чел.) без критических перегрузок.</div>`;
  } else {
    badgeEl.textContent = `Обнаружено ${items.length} замечаний`;
    badgeEl.style.color = "var(--warning)";
    listEl.innerHTML = items.join("");
  }
}
