import { PersistentWorkforceIntegrationStore } from '../integration/workforce/persistence';

export interface IntegrationPanelOptions {
  store: PersistentWorkforceIntegrationStore;
  onRefresh: () => void;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU');
}

export function renderIntegrationPanel(options: IntegrationPanelOptions): string {
  const logs = options.store.getLog().slice().reverse();
  const plans = options.store.getImportedPlans().slice().reverse();
  const batches = options.store.getActualFeedbackBatches().slice().reverse();
  const recent = logs.slice(0, 12);
  const inbound = logs.filter(item => item.direction === 'INBOUND').length;
  const outbound = logs.filter(item => item.direction === 'OUTBOUND').length;

  const rows = recent.map(item => `<tr><td><span class="integration-direction ${item.direction === 'INBOUND' ? 'integration-in' : 'integration-out'}">${item.direction === 'INBOUND' ? 'Вход' : 'Выход'}</span></td><td>${esc(item.messageType)}</td><td><code>${esc(item.idempotencyKey)}</code></td><td>${formatDate(item.receivedAt)}</td><td><span class="status-pill ${item.accepted ? 'status-ok' : 'status-danger'}">${item.accepted ? 'Принято' : 'Ошибка'}</span></td><td>${esc(item.message ?? '—')}</td></tr>`).join('');

  const planSummary = plans.slice(0, 5).map(plan => `<div class="integration-item"><strong>${esc(plan.planId)} · v${plan.version}</strong><span>${formatDate(plan.publishedAt)}</span><small>${esc(plan.companyExternalId)} → ${esc(plan.siteExternalId)} · ${plan.monthlyPlan.length} позиций</small></div>`).join('');
  const feedbackSummary = batches.slice(0, 5).map(batch => `<div class="integration-item"><strong>${formatDate(batch.sentAt)}</strong><span>${batch.events.length} событий</span><small>${esc(batch.sourceSiteExternalId)}</small></div>`).join('');

  return `<section class="panel integration-panel">
    <div class="panel-head"><div><h2>Интеграция Workforce ↔ MES</h2><div class="subtle">Вход: ${inbound} · Выход: ${outbound} · Обработано ключей: ${new Set(logs.map(item => item.idempotencyKey)).size}</div></div><button id="integration-refresh" class="primary">Обновить журнал</button></div>
    <div class="integration-cards"><div><span>Импортированные планы</span><strong>${plans.length}</strong></div><div><span>Actual feedback</span><strong>${batches.length}</strong></div><div><span>Записи журнала</span><strong>${logs.length}</strong></div></div>
    <div class="integration-grid"><div><div class="section-title">Последние планы</div>${planSummary || '<div class="integration-empty">Пока нет импортированных планов.</div>'}</div><div><div class="section-title">Последние feedback-пакеты</div>${feedbackSummary || '<div class="integration-empty">Пока нет отправленных feedback-пакетов.</div>'}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Направление</th><th>Тип</th><th>Idempotency</th><th>Время</th><th>Результат</th><th>Сообщение</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Журнал интеграции пока пуст</td></tr>'}</tbody></table></div>
  </section>`;
}

export function bindIntegrationPanel(root: ParentNode, options: IntegrationPanelOptions): void {
  root.querySelector<HTMLButtonElement>('#integration-refresh')?.addEventListener('click', options.onRefresh);
}
