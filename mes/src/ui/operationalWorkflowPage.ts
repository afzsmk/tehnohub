import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';

interface TaskRow {
  id: string;
  order_id: string;
  status: string;
  planned_quantity: number;
  actual_quantity: number;
  quality_required: boolean;
  quality_status: string;
  actual_start: string | null;
  actual_end: string | null;
  operation_sequence: number;
  version: number;
}

interface OrderRow {
  id: string;
  number: string;
  quantity: number;
  completed_quantity: number;
  due_at: string;
  status: string;
  priority: string;
}

interface InspectionRow {
  id: string;
  task_id: string;
  inspected_at: string;
  status: string;
  good_quantity: number;
  scrap_quantity: number;
  defect_code: string | null;
}

interface OutboxRow {
  id: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  created_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function pill(value: string): string {
  const ok = ['COMPLETED', 'APPROVED', 'SENT'];
  const warn = ['RUNNING', 'PAUSED', 'PARTIALLY_COMPLETED', 'PENDING', 'SENDING'];
  const danger = ['BLOCKED', 'CANCELLED', 'REJECTED', 'FAILED'];
  const cls = ok.includes(value) ? 'status-ok' : danger.includes(value) ? 'status-danger' : warn.includes(value) ? 'status-warning' : 'status-neutral';
  return `<span class="status-pill ${cls}">${esc(value)}</span>`;
}

function dt(value: string | null): string {
  return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export async function mountOperationalWorkflowPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  const role = auth.identity?.role;
  if (!role) return;

  const section = document.createElement('section');
  section.className = 'panel operational-workflow-page';
  section.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Операционный контур</h2>
        <div class="subtle">Единый контроль задания → факт → ОТК → заказ → Workforce · роль ${esc(role)}</div>
      </div>
      <button class="primary" data-workflow-refresh>Обновить</button>
    </div>
    <div class="workflow-kpis" data-workflow-kpis></div>
    <div class="workflow-grid">
      <div class="workflow-card"><h3>Задания</h3><div data-workflow-tasks></div></div>
      <div class="workflow-card"><h3>Последние решения ОТК</h3><div data-workflow-quality></div></div>
      <div class="workflow-card"><h3>Outbox → Workforce</h3><div data-workflow-outbox></div></div>
    </div>`;
  root.appendChild(section);

  const kpis = section.querySelector<HTMLElement>('[data-workflow-kpis]')!;
  const tasksHost = section.querySelector<HTMLElement>('[data-workflow-tasks]')!;
  const qualityHost = section.querySelector<HTMLElement>('[data-workflow-quality]')!;
  const outboxHost = section.querySelector<HTMLElement>('[data-workflow-outbox]')!;

  const refresh = async (): Promise<void> => {
    kpis.innerHTML = '<span class="subtle">Обновление…</span>';
    tasksHost.innerHTML = qualityHost.innerHTML = outboxHost.innerHTML = '<div class="subtle">Загрузка…</div>';
    try {
      const [ordersResult, tasksResult, qualityResult, outboxResult] = await Promise.all([
        client.from('production_orders').select('id,number,quantity,completed_quantity,due_at,status,priority').order('due_at', { ascending: true }).limit(250),
        client.from('production_tasks').select('id,order_id,status,planned_quantity,actual_quantity,quality_required,quality_status,actual_start,actual_end,operation_sequence,version').order('actual_start', { ascending: false }).limit(250),
        client.from('quality_inspections').select('id,task_id,inspected_at,status,good_quantity,scrap_quantity,defect_code').order('inspected_at', { ascending: false }).limit(8),
        client.from('integration_outbox').select('id,idempotency_key,status,attempts,created_at,last_attempt_at,last_error').order('created_at', { ascending: false }).limit(8)
      ]);
      for (const result of [ordersResult, tasksResult, qualityResult, outboxResult]) if (result.error) throw result.error;

      const orders = (ordersResult.data ?? []) as OrderRow[];
      const tasks = (tasksResult.data ?? []) as TaskRow[];
      const inspections = (qualityResult.data ?? []) as InspectionRow[];
      const outbox = (outboxResult.data ?? []) as OutboxRow[];

      const running = tasks.filter(task => ['RUNNING', 'PAUSED', 'PARTIALLY_COMPLETED'].includes(task.status)).length;
      const awaitingQuality = tasks.filter(task => task.quality_required && task.quality_status === 'PENDING').length;
      const completedTasks = tasks.filter(task => task.status === 'COMPLETED').length;
      const blockedOrders = orders.filter(order => order.status === 'BLOCKED').length;
      const sent = outbox.filter(item => item.status === 'SENT').length;
      const pending = outbox.filter(item => ['PENDING', 'SENDING', 'FAILED'].includes(item.status)).length;

      kpis.innerHTML = [
        ['Заказы', orders.length, ''],
        ['Задания в работе', running, 'warning'],
        ['Ожидают ОТК', awaitingQuality, awaitingQuality ? 'warning' : ''],
        ['Завершённые задания', completedTasks, 'ok'],
        ['Заблокированные заказы', blockedOrders, blockedOrders ? 'danger' : ''],
        ['Outbox: требует доставки', pending, pending ? 'warning' : '']
      ].map(([label, value, state]) => `<div class="workflow-kpi"><div class="subtle">${label}</div><strong class="${state ? `kpi-${state}` : ''}">${value}</strong></div>`).join('');

      tasksHost.innerHTML = tasks.length ? `<div class="workflow-list">${tasks.slice(0, 12).map(task => {
        const order = orders.find(item => item.id === task.order_id);
        const progress = task.planned_quantity > 0 ? Math.min(100, task.actual_quantity / task.planned_quantity * 100) : 0;
        return `<div class="workflow-row"><div><strong>${esc(order?.number ?? task.order_id)}</strong><div class="subtle">${esc(task.id)} · операция ${task.operation_sequence} · v${task.version}</div></div><div>${pill(task.status)}</div><div class="workflow-progress"><span style="width:${progress.toFixed(1)}%"></span></div><div class="subtle">${task.actual_quantity} / ${task.planned_quantity}${task.quality_required ? ` · ОТК ${pill(task.quality_status)}` : ''}</div><div class="subtle">${dt(task.actual_start)} → ${dt(task.actual_end)}</div></div>`;
      }).join('')}</div>` : '<div class="subtle">Заданий нет.</div>';

      qualityHost.innerHTML = inspections.length ? `<div class="workflow-list">${inspections.map(item => `<div class="workflow-row"><div><strong>${esc(item.task_id)}</strong><div class="subtle">${dt(item.inspected_at)}</div></div><div>${pill(item.status)}</div><div>${item.good_quantity} годн. / ${item.scrap_quantity} брака</div><div class="subtle">${esc(item.defect_code ?? 'Без дефекта')}</div></div>`).join('')}</div>` : '<div class="subtle">Решений ОТК пока нет.</div>';

      outboxHost.innerHTML = outbox.length ? `<div class="workflow-list">${outbox.map(item => `<div class="workflow-row"><div><strong>${esc(item.idempotency_key)}</strong><div class="subtle">попытки ${item.attempts} · ${dt(item.created_at)}</div></div><div>${pill(item.status)}</div><div class="subtle">${dt(item.last_attempt_at)}</div><div class="subtle">${esc(item.last_error ?? '')}</div></div>`).join('')}</div>` : '<div class="subtle">Записей outbox нет.</div>';
    } catch (error) {
      const message = esc(error instanceof Error ? error.message : 'Ошибка загрузки операционного контура');
      kpis.innerHTML = `<div class="detail-error">${message}</div>`;
      tasksHost.innerHTML = qualityHost.innerHTML = outboxHost.innerHTML = '<div class="subtle">Данные недоступны.</div>';
    }
  };

  section.querySelector<HTMLButtonElement>('[data-workflow-refresh]')?.addEventListener('click', () => void refresh());
  await refresh();
}
