import { DowntimeEvent, ProductionOrder, ProductionResult, ProductionTask } from '../types';
import { buildOrderPlanFact, buildPlanFactSummary } from '../core/planFact';

export interface PlanFactPanelOptions {
  orders: ProductionOrder[];
  tasks: ProductionTask[];
  results: ProductionResult[];
  downtimes: DowntimeEvent[];
  now?: Date;
}

function pct(value: number): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

function minutes(value: number): string {
  const sign = value < 0 ? '−' : '';
  const total = Math.abs(Math.round(value));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${sign}${hours}ч ${String(mins).padStart(2, '0')}м`;
}

export function renderPlanFactPanel(options: PlanFactPanelOptions): string {
  const now = options.now ?? new Date();
  const summary = buildPlanFactSummary(options.tasks, options.results, options.downtimes, now);
  const orders = buildOrderPlanFact(options.orders, options.tasks, options.results, now);
  const rows = orders.map(order => `<tr class="${order.overdue ? 'row-conflict' : ''}">
    <td><strong>${order.orderNumber}</strong></td>
    <td>${order.plannedQuantity}</td>
    <td>${order.goodQuantity}</td>
    <td>${order.scrapQuantity}</td>
    <td>${pct(order.completionPercent)}</td>
    <td>${order.quantityVariance > 0 ? '+' : ''}${order.quantityVariance}</td>
    <td>${new Date(order.dueAt).toLocaleDateString('ru-RU')}</td>
    <td>${order.overdue ? 'Просрочен' : 'В графике'}</td>
  </tr>`).join('');

  return `<section class="panel plan-fact-panel">
    <div class="panel-head"><div><h2>План → факт</h2><div class="subtle">Производительность, отклонения и влияние простоев</div></div></div>
    <div class="plan-fact-kpis">
      <article><span>План</span><strong>${summary.plannedQuantity}</strong></article>
      <article><span>Годный выпуск</span><strong>${summary.goodQuantity}</strong></article>
      <article><span>Выполнение</span><strong>${pct(summary.completionPercent)}</strong></article>
      <article><span>Брак</span><strong>${summary.scrapQuantity} · ${pct(summary.scrapPercent)}</strong></article>
      <article><span>Завершено заданий</span><strong>${summary.completedTasks}</strong></article>
      <article class="${summary.overdueTasks ? 'danger' : ''}"><span>Просроченные</span><strong>${summary.overdueTasks}</strong></article>
      <article><span>Простои</span><strong>${minutes(summary.downtimeMinutes)}</strong></article>
      <article><span>События простоя</span><strong>${summary.downtimeEvents}</strong></article>
    </div>
    <div class="plan-fact-table"><table><thead><tr><th>Заказ</th><th>План</th><th>Годный</th><th>Брак</th><th>Выполнение</th><th>Отклонение</th><th>Срок</th><th>Состояние</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Нет данных</td></tr>'}</tbody></table></div>
  </section>`;
}
