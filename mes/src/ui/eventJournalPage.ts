import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';

interface EventRow {
  id: string;
  task_id: string | null;
  type: string;
  occurred_at: string;
  actor_id: string;
  payload: Record<string, unknown> | null;
}
interface TaskRow { id: string; order_id: string; operation_sequence: number; }
interface OrderRow { id: string; number: string; }

const EVENT_LABELS: Record<string, string> = {
  TASK_STARTED: 'Запуск задания',
  TASK_PAUSED: 'Пауза',
  TASK_RESUMED: 'Продолжение',
  TASK_COMPLETED: 'Завершение задания',
  RESULT_RECORDED: 'Зафиксирован выпуск',
  DOWNTIME_STARTED: 'Начало простоя',
  DOWNTIME_ENDED: 'Окончание простоя',
  MAINTENANCE_STARTED: 'Начало ТО',
  MAINTENANCE_COMPLETED: 'Окончание ТО'
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[ch] ?? ch));
}
function payloadSummary(payload: Record<string, unknown> | null): string {
  if (!payload || Object.keys(payload).length === 0) return '—';
  const entries = Object.entries(payload).slice(0, 5).map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  return entries.join(' · ');
}

export async function mountEventJournalPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;

  const [eventResponse, taskResponse, orderResponse] = await Promise.all([
    client.from('production_events').select('id,task_id,type,occurred_at,actor_id,payload').order('occurred_at', { ascending: false }).limit(500),
    client.from('production_tasks').select('id,order_id,operation_sequence').order('planned_start', { ascending: true }),
    client.from('production_orders').select('id,number').order('number', { ascending: true })
  ]);
  if (eventResponse.error) throw eventResponse.error;
  if (taskResponse.error) throw taskResponse.error;
  if (orderResponse.error) throw orderResponse.error;

  const events = (Array.isArray(eventResponse.data) ? eventResponse.data : []) as EventRow[];
  const tasks = (Array.isArray(taskResponse.data) ? taskResponse.data : []) as TaskRow[];
  const orders = (Array.isArray(orderResponse.data) ? orderResponse.data : []) as OrderRow[];
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const orderMap = new Map(orders.map(order => [order.id, order]));

  const host = document.createElement('section');
  host.className = 'panel event-journal-page';
  host.innerHTML = `<div class="panel-head"><div><h2>Журнал производственных событий</h2><div class="subtle">Последние ${events.length} событий · append-only · роль ${esc(auth.identity.role)}</div></div></div>
    <div class="event-journal-filters">
      <label>Заказ<select id="event-order-filter"><option value="">Все заказы</option>${orders.map(order => `<option value="${esc(order.id)}">${esc(order.number)}</option>`).join('')}</select></label>
      <label>Событие<select id="event-type-filter"><option value="">Все события</option>${Object.entries(EVENT_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label>Задание<input id="event-task-filter" placeholder="ID задания"></label>
      <label>Поиск<input id="event-text-filter" placeholder="Заказ, оператор, данные"></label>
    </div>
    <div class="execution-table-wrap"><table><thead><tr><th>Время</th><th>Событие</th><th>Заказ</th><th>Задание</th><th>Оператор / автор</th><th>Данные</th></tr></thead><tbody id="event-journal-body"></tbody></table></div>`;

  root.appendChild(host);
  const body = host.querySelector<HTMLTableSectionElement>('#event-journal-body');
  const renderRows = (): void => {
    const orderId = (host.querySelector<HTMLSelectElement>('#event-order-filter')?.value ?? '').trim();
    const type = (host.querySelector<HTMLSelectElement>('#event-type-filter')?.value ?? '').trim();
    const taskFilter = (host.querySelector<HTMLInputElement>('#event-task-filter')?.value ?? '').trim().toLowerCase();
    const textFilter = (host.querySelector<HTMLInputElement>('#event-text-filter')?.value ?? '').trim().toLowerCase();
    const filtered = events.filter(event => {
      const task = event.task_id ? taskMap.get(event.task_id) : undefined;
      const order = task ? orderMap.get(task.order_id) : undefined;
      const haystack = [event.id, event.task_id ?? '', event.actor_id, event.type, payloadSummary(event.payload), order?.id ?? '', order?.number ?? ''].join(' ').toLowerCase();
      return (!orderId || order?.id === orderId)
        && (!type || event.type === type)
        && (!taskFilter || (event.task_id ?? '').toLowerCase().includes(taskFilter))
        && (!textFilter || haystack.includes(textFilter));
    });
    body!.innerHTML = filtered.map(event => {
      const task = event.task_id ? taskMap.get(event.task_id) : undefined;
      const order = task ? orderMap.get(task.order_id) : undefined;
      return `<tr><td>${esc(new Date(event.occurred_at).toLocaleString('ru-RU'))}</td><td><strong>${esc(EVENT_LABELS[event.type] ?? event.type)}</strong><div class="subtle">${esc(event.type)}</div></td><td>${order ? `<strong>${esc(order.number)}</strong><div class="subtle">${esc(order.id)}</div>` : '—'}</td><td>${task ? `<strong>${esc(task.id)}</strong><div class="subtle">оп. ${esc(task.operation_sequence)}</div>` : event.task_id ? esc(event.task_id) : '—'}</td><td>${esc(event.actor_id)}</td><td><span class="event-payload">${esc(payloadSummary(event.payload))}</span></td></tr>`;
    }).join('') || '<tr><td colspan="6">По заданным фильтрам событий нет</td></tr>';
  };

  host.querySelectorAll('select,input').forEach(control => control.addEventListener('input', renderRows));
  host.querySelectorAll('select').forEach(control => control.addEventListener('change', renderRows));
  renderRows();
}
