import './ordersPage.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionOrder } from '../types';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesExecutionRpc, MesExecutionAction } from '../integration/mesExecutionRpc';
import { SupabaseMesOrderRpc } from '../integration/mesOrderRpc';

const PLANNING_ROLES = ['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'];
const RELEASE_ROLES = ['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER'];

type OrderRow = {
  id: string;
  external_id: string | null;
  number: string;
  product_id: string;
  quantity: number;
  completed_quantity: number;
  due_at: string;
  priority: ProductionOrder['priority'];
  status: ProductionOrder['status'];
};

type RouteRow = {
  id: string;
  product_id: string;
  sequence: number;
  code: string;
  name: string;
  work_center: string;
  setup_minutes: number;
  run_minutes_per_unit: number;
};

type TaskRow = {
  id: string;
  order_id: string;
  operation_id: string;
  operation_sequence: number;
  status: string;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  planned_quantity: number;
  actual_quantity: number;
  quality_required: boolean;
  quality_status: string;
};

type AssignmentRow = {
  task_id: string;
  employee_id: string | null;
  equipment_id: string | null;
};

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch] ?? ch)); }
function statusLabel(value: string): string { return ({IMPORTED:'Импортирован',PLANNED:'Запланирован',RELEASED:'Выпущен',IN_EXECUTION:'В работе',PARTIALLY_COMPLETED:'Частично выполнен',COMPLETED:'Завершён',BLOCKED:'Заблокирован',CANCELLED:'Отменён'} as Record<string,string>)[value] ?? value; }
function taskStatusLabel(value: string): string { return ({DRAFT:'Черновик',PLANNED:'Запланировано',ASSIGNED:'Назначено',READY:'Готово',RUNNING:'Выполняется',PAUSED:'Пауза',BLOCKED:'Заблокировано',PARTIALLY_COMPLETED:'Частично',COMPLETED:'Завершено',CANCELLED:'Отменено'} as Record<string,string>)[value] ?? value; }
function qualityLabel(value: string): string { return ({NOT_REQUIRED:'Не требуется',PENDING:'Ожидает ОТК',APPROVED:'Одобрено',REJECTED:'Отклонено'} as Record<string,string>)[value] ?? value; }
function statusClass(value: string): string { return ['COMPLETED','APPROVED'].includes(value) ? 'status-ok' : ['BLOCKED','CANCELLED','REJECTED'].includes(value) ? 'status-danger' : ['IN_EXECUTION','PARTIALLY_COMPLETED','PENDING'].includes(value) ? 'status-warning' : 'status-neutral'; }
function formatDateTime(value: string | null): string { return value ? new Date(value).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}) : '—'; }

function normalizeOrder(row: Record<string, unknown>): OrderRow {
  return {
    id: String(row.id),
    external_id: row.external_id == null ? null : String(row.external_id),
    number: String(row.number),
    product_id: String(row.product_id),
    quantity: Number(row.quantity),
    completed_quantity: Number(row.completed_quantity),
    due_at: String(row.due_at),
    priority: row.priority as ProductionOrder['priority'],
    status: row.status as ProductionOrder['status'],
  };
}

function normalizeRoute(row: Record<string, unknown>): RouteRow {
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    sequence: Number(row.sequence),
    code: String(row.code),
    name: String(row.name),
    work_center: String(row.work_center),
    setup_minutes: Number(row.setup_minutes),
    run_minutes_per_unit: Number(row.run_minutes_per_unit),
  };
}

function normalizeTask(row: Record<string, unknown>): TaskRow {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    operation_id: String(row.operation_id),
    operation_sequence: Number(row.operation_sequence),
    status: String(row.status),
    planned_start: String(row.planned_start),
    planned_end: String(row.planned_end),
    actual_start: row.actual_start == null ? null : String(row.actual_start),
    actual_end: row.actual_end == null ? null : String(row.actual_end),
    planned_quantity: Number(row.planned_quantity),
    actual_quantity: Number(row.actual_quantity),
    quality_required: Boolean(row.quality_required),
    quality_status: String(row.quality_status ?? 'NOT_REQUIRED'),
  };
}

function normalizeAssignment(row: Record<string, unknown>): AssignmentRow {
  return {
    task_id: String(row.task_id),
    employee_id: row.employee_id == null ? null : String(row.employee_id),
    equipment_id: row.equipment_id == null ? null : String(row.equipment_id),
  };
}

function actionButtons(task: TaskRow): string {
  const buttons: string[] = [];
  if (task.status === 'PLANNED' || task.status === 'ASSIGNED') buttons.push(`<button class="tiny" data-task-action="PREPARE" data-task-id="${esc(task.id)}">Подготовить</button>`);
  if (task.status === 'READY') buttons.push(`<button class="tiny action-start" data-task-action="START" data-task-id="${esc(task.id)}">▶ Запустить</button>`);
  if (task.status === 'RUNNING') buttons.push(`<button class="tiny" data-task-action="PAUSE" data-task-id="${esc(task.id)}">Ⅱ Пауза</button>`);
  if (task.status === 'PAUSED') buttons.push(`<button class="tiny action-start" data-task-action="RESUME" data-task-id="${esc(task.id)}">▶ Продолжить</button>`);
  if (task.status === 'RUNNING' || task.status === 'PARTIALLY_COMPLETED' || task.status === 'PAUSED') buttons.push(`<button class="tiny" data-task-action="BLOCK" data-task-id="${esc(task.id)}">⚠ Блок</button>`);
  const canComplete = (task.status === 'RUNNING' || task.status === 'PARTIALLY_COMPLETED') && (!task.quality_required || task.quality_status === 'APPROVED');
  if (canComplete) buttons.push(`<button class="tiny action-complete" data-task-action="COMPLETE" data-task-id="${esc(task.id)}">✓ Завершить</button>`);
  return buttons.join(' ') || '<span class="subtle">—</span>';
}

export async function mountOrdersPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  const role = auth.identity?.role;
  if (!role) return;
  const canPlan = PLANNING_ROLES.includes(role);
  const canRelease = RELEASE_ROLES.includes(role);
  const { data, error } = await client.from('production_orders').select('id,external_id,number,product_id,quantity,completed_quantity,due_at,priority,status').order('due_at',{ascending:true});
  if (error) throw error;
  const orders: OrderRow[] = Array.isArray(data) ? data.map(row => normalizeOrder(row as Record<string, unknown>)) : [];

  const host=document.createElement('section');
  host.className='panel orders-page';
  host.innerHTML=`<div class="panel-head"><div><h2>Производственные заказы</h2><div class="subtle">Оперативное управление статусом, маршрутом и заданиями · роль ${esc(role)}</div></div><button class="primary" id="orders-refresh">Обновить</button></div>
    <div class="orders-toolbar"><span>${orders.length} заказов</span><span>Запланированных: ${orders.filter(o=>o.status==='PLANNED').length}</span><span>В работе: ${orders.filter(o=>['IN_EXECUTION','PARTIALLY_COMPLETED'].includes(o.status)).length}</span><span>Завершённых: ${orders.filter(o=>o.status==='COMPLETED').length}</span></div>
    <div class="orders-table-wrap"><table><thead><tr><th>Заказ</th><th>Количество</th><th>Выполнено</th><th>Срок</th><th>Приоритет</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${orders.map(o=>{
      const action=[] as string[];
      action.push(`<button class="tiny" data-order-detail="${esc(o.id)}">Детали</button>`);
      if(canPlan && ['IMPORTED','BLOCKED'].includes(o.status)) action.push(`<button class="tiny" data-plan-order="${esc(o.id)}">Спланировать</button>`);
      if(canRelease && o.status==='PLANNED') action.push(`<button class="tiny" data-release-order="${esc(o.id)}">Выпустить</button>`);
      if(canRelease && ['RELEASED','IN_EXECUTION'].includes(o.status)) action.push(`<button class="tiny" data-block-order="${esc(o.id)}">Заблокировать</button>`);
      const pct=o.quantity>0?((o.completed_quantity/o.quantity)*100).toFixed(1):'0.0';
      return `<tr data-order-row="${esc(o.id)}"><td><strong>${esc(o.number)}</strong><div class="subtle">${esc(o.external_id??'')} · ${esc(o.id)}</div></td><td>${o.quantity}</td><td>${o.completed_quantity} <span class="subtle">(${pct}%)</span></td><td>${new Date(o.due_at).toLocaleDateString('ru-RU')}</td><td>${esc(o.priority)}</td><td><span class="status-pill ${statusClass(o.status)}">${statusLabel(o.status)}</span></td><td class="orders-actions">${action.join(' ')}</td></tr><tr data-order-detail-row="${esc(o.id)}" class="order-detail-row" hidden><td colspan="7"><div class="order-detail" data-detail-host="${esc(o.id)}"></div></td></tr>`;
    }).join('')||'<tr><td colspan="7">Заказов нет</td></tr>'}</tbody></table></div>`;
  root.appendChild(host);

  const rpc=new SupabaseMesOrderRpc(client);
  const executionRpc=new SupabaseMesExecutionRpc(client);
  const detailState = new Set<string>();

  const loadDetail = async (order: OrderRow, container: HTMLElement): Promise<void> => {
    container.innerHTML='<div class="subtle">Загрузка маршрута, заданий и назначений…</div>';
    try {
      const [routeResult, taskResult] = await Promise.all([
        client.from('route_operations').select('id,product_id,sequence,code,name,work_center,setup_minutes,run_minutes_per_unit').eq('product_id',order.product_id).eq('active',true).order('sequence',{ascending:true}),
        client.from('production_tasks').select('id,order_id,operation_id,operation_sequence,status,planned_start,planned_end,actual_start,actual_end,planned_quantity,actual_quantity,quality_required,quality_status').eq('order_id',order.id).order('operation_sequence',{ascending:true})
      ]);
      if (routeResult.error) throw routeResult.error;
      if (taskResult.error) throw taskResult.error;
      const route = Array.isArray(routeResult.data) ? routeResult.data.map(row => normalizeRoute(row as Record<string, unknown>)) : [];
      const tasks = Array.isArray(taskResult.data) ? taskResult.data.map(row => normalizeTask(row as Record<string, unknown>)) : [];
      const assignmentResult = tasks.length
        ? await client.from('task_assignments').select('task_id,employee_id,equipment_id').in('task_id',tasks.map(task=>task.id))
        : { data: [], error: null };
      if (assignmentResult.error) throw assignmentResult.error;
      const assignments = Array.isArray(assignmentResult.data) ? assignmentResult.data.map(row => normalizeAssignment(row as Record<string, unknown>)) : [];
      const taskByOperation = new Map(tasks.map(task => [task.operation_id, task]));
      const assignmentByTask = new Map<string, AssignmentRow>();
      for (const assignment of assignments) {
        if (!assignmentByTask.has(assignment.task_id)) assignmentByTask.set(assignment.task_id, assignment);
      }
      const employeeIds = [...new Set(assignments.map(item => item.employee_id).filter((id): id is string => Boolean(id)))];
      const equipmentIds = [...new Set(assignments.map(item => item.equipment_id).filter((id): id is string => Boolean(id)))];
      const [employeesResult, equipmentResult] = await Promise.all([
        employeeIds.length ? client.from('employees').select('id,name,qualification_level').in('id',employeeIds) : { data: [], error: null },
        equipmentIds.length ? client.from('equipment').select('id,name,work_center').in('id',equipmentIds) : { data: [], error: null }
      ]);
      if (employeesResult.error) throw employeesResult.error;
      if (equipmentResult.error) throw equipmentResult.error;
      const employeeMap = new Map((employeesResult.data ?? []).map(row => [String(row.id), String(row.name)]));
      const equipmentMap = new Map((equipmentResult.data ?? []).map(row => [String(row.id), String(row.name)]));
      container.innerHTML=`<div class="order-detail-head"><div><strong>Карточка заказа ${esc(order.number)}</strong><div class="subtle">Изделие: ${esc(order.product_id)} · срок ${formatDateTime(order.due_at)}</div></div><span class="status-pill ${statusClass(order.status)}">${statusLabel(order.status)}</span></div>
        <div class="order-detail-grid"><div><div class="detail-title">Технологический маршрут</div>${route.length?`<ol class="route-list">${route.map(op=>{const task=taskByOperation.get(op.id);return `<li><div class="route-line"><span class="route-seq">${op.sequence}</span><div><strong>${esc(op.code)} · ${esc(op.name)}</strong><div class="subtle">${esc(op.work_center)} · наладка ${op.setup_minutes} мин · ${op.run_minutes_per_unit} мин/ед.</div></div>${task?`<span class="status-pill ${statusClass(task.status)}">${taskStatusLabel(task.status)}</span>`:'<span class="subtle">задание не создано</span>'}</div></li>`;}).join('')}</ol>`:'<div class="empty-detail">Активный маршрут не найден.</div>'}</div>
        <div><div class="detail-title">Производственные задания</div>${tasks.length?`<div class="task-detail-table"><table><thead><tr><th>Операция</th><th>Статус</th><th>План</th><th>Факт</th><th>Ресурсы</th><th>Качество</th><th>Действия</th></tr></thead><tbody>${tasks.map(task=>{const assignment=assignmentByTask.get(task.id);const employee=assignment?.employee_id?employeeMap.get(assignment.employee_id):undefined;const equipment=assignment?.equipment_id?equipmentMap.get(assignment.equipment_id):undefined;return `<tr><td><strong>${esc(task.id)}</strong><div class="subtle">${task.operation_sequence} · ${esc(task.operation_id)}</div></td><td><span class="status-pill ${statusClass(task.status)}">${taskStatusLabel(task.status)}</span></td><td>${formatDateTime(task.planned_start)} → ${formatDateTime(task.planned_end)}<div class="subtle">${task.planned_quantity}</div></td><td>${task.actual_quantity}<div class="subtle">${formatDateTime(task.actual_start)} → ${formatDateTime(task.actual_end)}</div></td><td>${employee?`<div>${esc(employee)}</div>`:'<span class="subtle">Сотрудник не назначен</span>'}${equipment?`<div>${esc(equipment)}</div>`:'<div class="subtle">Оборудование не назначено</div>'}</td><td>${task.quality_required?`<span class="status-pill ${statusClass(task.quality_status)}">${qualityLabel(task.quality_status)}</span>`:'<span class="subtle">Не требуется</span>'}</td><td class="orders-actions"><span data-task-action-host="${esc(task.id)}">${actionButtons(task)}</span></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-detail">Производственные задания ещё не созданы.</div>'}</div></div>`;
    } catch (error) {
      container.innerHTML=`<div class="detail-error">Не удалось загрузить карточку: ${esc(error instanceof Error ? error.message : 'ошибка запроса')}</div>`;
    }
  };

  const refreshDetail = async (taskId: string, button: HTMLButtonElement): Promise<void> => {
    const orderId = [...detailState].find(id => host.querySelector(`[data-task-action-host=\"${CSS.escape(taskId)}\"]`));
    const taskRow = host.querySelector<HTMLElement>(`[data-task-action-host=\"${CSS.escape(taskId)}\"]`);
    const order = orders.find(item => item.id === (taskRow ? String((taskRow.closest('tr') as HTMLElement)?.dataset.orderId ?? '') : '')) ?? orders.find(item => detailState.has(item.id));
    if (!taskRow || !order) return;
    try {
      await executionRpc.executeTaskAction(taskId, button.dataset.taskAction as MesExecutionAction, new Date().toISOString());
      const row = taskRow.closest('tr');
      const detailRow = row?.parentElement?.parentElement?.closest('table')?.closest('div')?.querySelector<HTMLElement>(`[data-detail-host=\"${CSS.escape(order.id)}\"]`);
      if (detailRow) await loadDetail(order, detailRow);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось выполнить действие задания');
    }
  };

  host.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.taskAction || !target.dataset.taskId) return;
    event.preventDefault();
    void refreshDetail(target.dataset.taskId, target);
  });

  host.querySelectorAll<HTMLButtonElement>('[data-order-detail]').forEach(button=>button.addEventListener('click',()=>{
    const orderId=button.dataset.orderDetail??'';
    const order=orders.find(item=>item.id===orderId);
    const row=host.querySelector<HTMLTableRowElement>(`[data-order-detail-row="${CSS.escape(orderId)}"]`);
    const container=row?.querySelector<HTMLElement>('[data-detail-host]');
    if (!order || !row || !container) return;
    const open=!detailState.has(orderId);
    if(open) detailState.add(orderId); else detailState.delete(orderId);
    row.hidden=!open;
    button.textContent=open?'Скрыть':'Детали';
    if(open) void loadDetail(order,container);
  }));

  host.querySelector<HTMLButtonElement>('#orders-refresh')?.addEventListener('click',()=>window.location.reload());
  host.querySelectorAll<HTMLButtonElement>('[data-plan-order]').forEach(button=>button.addEventListener('click',async()=>{try{const r=await rpc.planOrder(button.dataset.planOrder??'');window.alert(`Создано заданий: ${r.createdTasks}; существовало: ${r.existingTasks}`);window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось спланировать заказ');}}));
  const change=async(button:HTMLButtonElement,next:ProductionOrder['status'])=>{try{await rpc.changeStatus(button.dataset.orderId??'',next);window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось изменить статус заказа');}};
  host.querySelectorAll<HTMLButtonElement>('[data-release-order]').forEach(button=>{button.dataset.orderId=button.dataset.releaseOrder??'';button.addEventListener('click',()=>void change(button,'RELEASED'));});
  host.querySelectorAll<HTMLButtonElement>('[data-block-order]').forEach(button=>{button.dataset.orderId=button.dataset.blockOrder??'';button.addEventListener('click',()=>void change(button,'BLOCKED'));});
}
