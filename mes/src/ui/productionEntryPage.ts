import './productionEntryPage.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionTask } from '../types';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesExecutionRpc } from '../integration/mesExecutionRpc';

const ENTRY_ROLES = ['ADMIN', 'PRODUCTION_MANAGER', 'MASTER', 'OPERATOR', 'DISPATCHER'];

interface TaskRow {
  id: string;
  order_id: string;
  operation_sequence: number;
  status: ProductionTask['status'];
  planned_quantity: number;
  actual_quantity: number;
  quality_required: boolean;
  quality_status: string;
  version: number;
}

interface OrderRow { id: string; number: string; quantity: number; status: string; }

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;' }[ch] ?? ch));
}

function label(value: string): string {
  return ({ RUNNING:'В работе', PAUSED:'Пауза', PARTIALLY_COMPLETED:'Частично', COMPLETED:'Завершено', PENDING:'Ожидает ОТК', APPROVED:'Одобрено', REJECTED:'Отклонено' } as Record<string,string>)[value] ?? value;
}

function statusClass(value: string): string {
  if (['COMPLETED','APPROVED'].includes(value)) return 'status-ok';
  if (['REJECTED','BLOCKED','CANCELLED'].includes(value)) return 'status-danger';
  if (['RUNNING','PAUSED','PARTIALLY_COMPLETED','PENDING'].includes(value)) return 'status-warning';
  return 'status-neutral';
}

export async function mountProductionEntryPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  const role = auth.identity?.role;
  if (!role || !ENTRY_ROLES.includes(role)) return;

  const host = document.createElement('section');
  host.className = 'panel production-entry-page';
  host.innerHTML = `
    <div class="panel-head">
      <div><h2>Регистрация производства</h2><div class="subtle">Фиксация фактического выпуска через серверный MES RPC · роль ${esc(role)}</div></div>
      <button class="primary" data-production-entry-refresh>Обновить</button>
    </div>
    <div class="production-entry-body" data-production-entry-body><div class="subtle">Загрузка…</div></div>`;
  root.appendChild(host);

  const body = host.querySelector<HTMLElement>('[data-production-entry-body]')!;
  const execution = new SupabaseMesExecutionRpc(client);

  const refresh = async (): Promise<void> => {
    body.innerHTML = '<div class="subtle">Загрузка заданий…</div>';
    try {
      const [tasksResult, ordersResult] = await Promise.all([
        client.from('production_tasks').select('id,order_id,operation_sequence,status,planned_quantity,actual_quantity,quality_required,quality_status,version').in('status', ['RUNNING','PAUSED','PARTIALLY_COMPLETED']).order('operation_sequence', { ascending: true }).limit(200),
        client.from('production_orders').select('id,number,quantity,status').limit(250)
      ]);
      if (tasksResult.error) throw tasksResult.error;
      if (ordersResult.error) throw ordersResult.error;
      const tasks = (tasksResult.data ?? []) as TaskRow[];
      const orders = (ordersResult.data ?? []) as OrderRow[];

      body.innerHTML = tasks.length ? `
        <div class="production-entry-list">
          ${tasks.map(task => {
            const order = orders.find(item => item.id === task.order_id);
            const remaining = Math.max(0, task.planned_quantity - task.actual_quantity);
            return `<form class="production-entry-card" data-result-task="${esc(task.id)}">
              <div class="production-entry-head">
                <div><strong>${esc(order?.number ?? task.order_id)}</strong><div class="subtle">Задание ${esc(task.id)} · операция ${task.operation_sequence} · v${task.version}</div></div>
                <span class="status-pill ${statusClass(task.status)}">${label(task.status)}</span>
              </div>
              <div class="production-entry-facts"><span>План: <strong>${task.planned_quantity}</strong></span><span>Факт: <strong>${task.actual_quantity}</strong></span><span>Осталось: <strong>${remaining}</strong></span>${task.quality_required ? `<span>ОТК: <strong class="status-pill ${statusClass(task.quality_status)}">${label(task.quality_status)}</strong></span>` : '<span>ОТК: не требуется</span>'}</div>
              <div class="production-entry-form-grid">
                <label>Годно<input name="good" type="number" min="0" max="${remaining}" step="0.001" value="${remaining}" required></label>
                <label>Брак<input name="scrap" type="number" min="0" step="0.001" value="0" required></label>
                <label class="production-entry-comment">Комментарий<input name="comment" type="text" maxlength="500" placeholder="Причина/примечание"></label>
                <button class="primary" type="submit">Зафиксировать факт</button>
              </div>
            </form>`;
          }).join('')}
        </div>` : '<div class="subtle">Нет выполняемых заданий, доступных для регистрации выпуска.</div>';

      body.querySelectorAll<HTMLFormElement>('[data-result-task]').forEach(form => {
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const taskId = form.dataset.resultTask ?? '';
          const good = Number((form.elements.namedItem('good') as HTMLInputElement)?.value ?? 0);
          const scrap = Number((form.elements.namedItem('scrap') as HTMLInputElement)?.value ?? 0);
          const comment = (form.elements.namedItem('comment') as HTMLInputElement)?.value ?? '';
          if (!taskId || !Number.isFinite(good) || !Number.isFinite(scrap) || good < 0 || scrap < 0 || good + scrap <= 0) {
            window.alert('Укажите корректное количество годных изделий и брака.');
            return;
          }
          const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
          if (button) button.disabled = true;
          try {
            await execution.recordProductionResult(taskId, good, scrap, [], comment || undefined, new Date().toISOString());
            await refresh();
          } catch (error) {
            window.alert(error instanceof Error ? error.message : 'Не удалось зарегистрировать факт выпуска');
            if (button) button.disabled = false;
          }
        });
      });
    } catch (error) {
      body.innerHTML = `<div class="detail-error">${esc(error instanceof Error ? error.message : 'Ошибка загрузки заданий')}</div>`;
    }
  };

  host.querySelector<HTMLButtonElement>('[data-production-entry-refresh]')?.addEventListener('click', () => void refresh());
  await refresh();
}
