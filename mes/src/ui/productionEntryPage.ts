import './productionEntryPage.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionTask } from '../types';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesExecutionRpc, MesExecutionAction } from '../integration/mesExecutionRpc';
import { subscribeMesRealtime } from '../integration/mesRealtime';

const ENTRY_ROLES = ['ADMIN', 'PRODUCTION_MANAGER', 'MASTER', 'OPERATOR', 'DISPATCHER'];

type AssignmentRow = { task_id: string; employee_id: string | null; equipment_id: string | null };
interface TaskRow { id: string; order_id: string; operation_sequence: number; status: ProductionTask['status']; planned_quantity: number; actual_quantity: number; quality_required: boolean; quality_status: string; actual_start: string | null; actual_end: string | null; version: number; }
interface OrderRow { id: string; number: string; quantity: number; status: string; }
interface EmployeeRow { id: string; name: string; }
interface EquipmentRow { id: string; name: string; }

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\\"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;' }[ch] ?? ch)); }
function label(value: string): string { return ({ READY:'Готово', RUNNING:'В работе', PAUSED:'Пауза', BLOCKED:'Заблокировано', PARTIALLY_COMPLETED:'Частично', COMPLETED:'Завершено', PENDING:'Ожидает ОТК', APPROVED:'Одобрено', REJECTED:'Отклонено' } as Record<string,string>)[value] ?? value; }
function statusClass(value: string): string { if (['COMPLETED','APPROVED'].includes(value)) return 'status-ok'; if (['REJECTED','BLOCKED','CANCELLED'].includes(value)) return 'status-danger'; if (['RUNNING','PAUSED','PARTIALLY_COMPLETED','PENDING'].includes(value)) return 'status-warning'; return 'status-neutral'; }
function newIdempotencyKey(): string { return crypto.randomUUID(); }
function actionButtons(task: TaskRow): string {
  const buttons: string[] = [];
  if (task.status === 'READY') buttons.push(`<button class="primary" type="button" data-task-action="START" data-task-id="${esc(task.id)}">▶ Запустить</button>`);
  if (task.status === 'RUNNING') buttons.push(`<button class="tiny" type="button" data-task-action="PAUSE" data-task-id="${esc(task.id)}">Ⅱ Пауза</button>`);
  if (task.status === 'PAUSED') buttons.push(`<button class="tiny action-start" type="button" data-task-action="RESUME" data-task-id="${esc(task.id)}">▶ Продолжить</button>`);
  if (['RUNNING','PAUSED','PARTIALLY_COMPLETED'].includes(task.status)) buttons.push(`<button class="tiny" type="button" data-task-action="BLOCK" data-task-id="${esc(task.id)}">⚠ Блокировать</button>`);
  const qualityAllowed = !task.quality_required || task.quality_status === 'APPROVED';
  if (['RUNNING','PARTIALLY_COMPLETED'].includes(task.status) && task.actual_quantity >= task.planned_quantity && qualityAllowed) buttons.push(`<button class="tiny action-complete" type="button" data-task-action="COMPLETE" data-task-id="${esc(task.id)}">✓ Завершить</button>`);
  return buttons.join(' ') || '<span class="subtle">Ожидает подготовки диспетчером</span>';
}

export async function mountProductionEntryPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client); const role = auth.identity?.role;
  if (!role || !ENTRY_ROLES.includes(role)) return;
  const host = document.createElement('section'); host.className = 'panel production-entry-page';
  host.innerHTML = `<div class="panel-head"><div><h2>Рабочее место оператора</h2><div class="subtle">Запуск · пауза · продолжение · блокировка · выпуск · завершение</div></div><button class="primary" data-production-entry-refresh>Обновить</button></div><div class="production-entry-body" data-production-entry-body><div class="subtle">Загрузка…</div></div>`;
  root.appendChild(host);
  const body = host.querySelector<HTMLElement>('[data-production-entry-body]')!; const execution = new SupabaseMesExecutionRpc(client);
  const refresh = async (): Promise<void> => {
    body.innerHTML = '<div class="subtle">Загрузка заданий…</div>';
    try {
      const [tasksResult, ordersResult] = await Promise.all([
        client.from('production_tasks').select('id,order_id,operation_sequence,status,planned_quantity,actual_quantity,quality_required,quality_status,actual_start,actual_end,version').in('status', ['READY','RUNNING','PAUSED','PARTIALLY_COMPLETED']).order('operation_sequence', { ascending: true }).limit(200),
        client.from('production_orders').select('id,number,quantity,status').limit(250)
      ]);
      if (tasksResult.error) throw tasksResult.error; if (ordersResult.error) throw ordersResult.error;
      const loadedTasks = (tasksResult.data ?? []) as TaskRow[]; const orders = (ordersResult.data ?? []) as OrderRow[];
      const assignmentsResult = loadedTasks.length ? await client.from('task_assignments').select('task_id,employee_id,equipment_id').in('task_id', loadedTasks.map(task => task.id)) : { data: [], error: null };
      if (assignmentsResult.error) throw assignmentsResult.error;
      const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
      const assignmentByTask = new Map<string, AssignmentRow>();
      assignments.forEach(item => assignmentByTask.set(item.task_id, item));
      const tasks = role === 'OPERATOR'
        ? auth.identity?.employeeId
          ? loadedTasks.filter(task => assignmentByTask.get(task.id)?.employee_id === auth.identity?.employeeId)
          : []
        : loadedTasks;
      const visibleTaskIds = new Set(tasks.map(task => task.id));
      const visibleAssignments = assignments.filter(item => visibleTaskIds.has(item.task_id));
      const visibleAssignmentByTask = new Map<string, AssignmentRow>();
      visibleAssignments.forEach(item => visibleAssignmentByTask.set(item.task_id, item));
      const employeeIds = [...new Set(visibleAssignments.map(item => item.employee_id).filter((id): id is string => Boolean(id)))]; const equipmentIds = [...new Set(visibleAssignments.map(item => item.equipment_id).filter((id): id is string => Boolean(id)))];
      const [employeesResult, equipmentResult] = await Promise.all([
        employeeIds.length ? client.from('employees').select('id,name').in('id', employeeIds) : Promise.resolve({ data: [], error: null }),
        equipmentIds.length ? client.from('equipment').select('id,name').in('id', equipmentIds) : Promise.resolve({ data: [], error: null })
      ]);
      if (employeesResult.error) throw employeesResult.error; if (equipmentResult.error) throw equipmentResult.error;
      const employees = (employeesResult.data ?? []) as EmployeeRow[]; const equipment = (equipmentResult.data ?? []) as EquipmentRow[];
      const employeeName = new Map(employees.map(item => [item.id, item.name])); const equipmentName = new Map(equipment.map(item => [item.id, item.name]));
      body.innerHTML = tasks.length ? `<div class="production-entry-list">${tasks.map(task => {
        const order = orders.find(item => item.id === task.order_id); const assignment = visibleAssignmentByTask.get(task.id); const remaining = Math.max(0, task.planned_quantity - task.actual_quantity); const completion = task.planned_quantity > 0 ? Math.min(100, task.actual_quantity / task.planned_quantity * 100) : 0; const canRecord = ['RUNNING','PAUSED','PARTIALLY_COMPLETED'].includes(task.status) && remaining > 0; const equipmentId = assignment?.equipment_id ?? '';
        return `<article class="production-entry-card" data-task-card="${esc(task.id)}"><div class="production-entry-head"><div><strong>${esc(order?.number ?? task.order_id)}</strong><div class="subtle">Задание ${esc(task.id)} · операция ${task.operation_sequence} · v${task.version}</div></div><span class="status-pill ${statusClass(task.status)}">${label(task.status)}</span></div><div class="production-entry-facts"><span>План: <strong>${task.planned_quantity}</strong></span><span>Факт: <strong>${task.actual_quantity}</strong></span><span>Осталось: <strong>${remaining}</strong></span><span>Прогресс: <strong>${completion.toFixed(1)}%</strong></span><span>Оператор: <strong>${esc(employeeName.get(assignment?.employee_id ?? '') ?? 'не назначен')}</strong></span><span>Оборудование: <strong>${esc(equipmentName.get(equipmentId) ?? 'не назначено')}</strong></span>${task.quality_required ? `<span>ОТК: <strong class="status-pill ${statusClass(task.quality_status)}">${label(task.quality_status)}</strong></span>` : '<span>ОТК: не требуется</span>'}</div><div class="production-entry-actions">${actionButtons(task)}</div>${canRecord ? `<form class="production-entry-form" data-result-task="${esc(task.id)}"><div class="production-entry-form-grid"><label>Годно<input name="good" type="number" min="0" max="${remaining}" step="0.001" value="${remaining}" required></label><label>Брак<input name="scrap" type="number" min="0" step="0.001" value="0" required></label><label class="production-entry-comment">Комментарий<input name="comment" type="text" maxlength="500" placeholder="Причина / примечание"></label><button class="primary" type="submit">Зафиксировать выпуск</button></div></form>` : '<div class="subtle">Для регистрации выпуска сначала запустите задание.</div>'}</article>`;
      }).join('')}</div>` : role === 'OPERATOR' && !auth.identity?.employeeId
        ? '<div class="subtle">Рабочее место оператора не привязано к сотруднику. Обратитесь к администратору MES.</div>'
        : '<div class="subtle">Нет назначенных заданий в рабочем состоянии. Диспетчер должен подготовить и назначить ресурсам следующее задание.</div>';
      body.querySelectorAll<HTMLButtonElement>('[data-task-action]').forEach(button => button.addEventListener('click', async () => {
        const taskId = button.dataset.taskId ?? ''; const action = button.dataset.taskAction as MesExecutionAction; if (!taskId || !['START','PAUSE','RESUME','BLOCK','COMPLETE'].includes(action)) return; button.disabled = true;
        try { await execution.executeTaskAction(taskId, action, new Date().toISOString()); await refresh(); } catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось изменить состояние задания'); button.disabled = false; }
      }));
      body.querySelectorAll<HTMLFormElement>('[data-result-task]').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault(); const taskId = form.dataset.resultTask ?? ''; const good = Number((form.elements.namedItem('good') as HTMLInputElement)?.value ?? 0); const scrap = Number((form.elements.namedItem('scrap') as HTMLInputElement)?.value ?? 0); const comment = (form.elements.namedItem('comment') as HTMLInputElement)?.value ?? '';
        if (!taskId || !Number.isFinite(good) || !Number.isFinite(scrap) || good < 0 || scrap < 0 || good + scrap <= 0) { window.alert('Укажите корректное количество годных изделий и брака.'); return; }
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (button?.disabled) return; if (button) button.disabled = true; const idempotencyKey = form.dataset.idempotencyKey ?? newIdempotencyKey(); form.dataset.idempotencyKey = idempotencyKey;
        try { await execution.recordProductionResult(taskId, good, scrap, equipmentIdFor(taskId, visibleAssignmentByTask), comment || undefined, new Date().toISOString(), idempotencyKey); await refresh(); } catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось зарегистрировать факт выпуска'); if (button) button.disabled = false; }
      }));
      function equipmentIdFor(taskId: string, map: Map<string, AssignmentRow>): string[] { const id = map.get(taskId)?.equipment_id; return id ? [id] : []; }
    } catch (error) { body.innerHTML = `<div class="detail-error">${esc(error instanceof Error ? error.message : 'Ошибка загрузки заданий')}</div>`; }
  };
  host.querySelector<HTMLButtonElement>('[data-production-entry-refresh]')?.addEventListener('click', () => void refresh());
  subscribeMesRealtime(client, { tables: ['production_tasks','task_assignments','production_orders','production_results','quality_inspections'], debounceMs: 350, onChange: () => void refresh() });
  await refresh();
}
