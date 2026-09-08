import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { subscribeMesRealtime } from '../integration/mesRealtime';

type TaskRow = { id:string; order_id:string; operation_sequence:number; status:string; planned_quantity:number; actual_quantity:number; planned_start:string; planned_end:string; };
type OrderRow = { id:string; number:string; priority:string; due_at:string; };
type AssignmentRow = { task_id:string; equipment_id:string|null; employee_id:string|null };
type EquipmentRow = { id:string; code:string; name:string; work_center:string; };

const esc = (v:unknown) => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c] ?? c));
const statusLabel = (v:string) => ({PLANNED:'Запланировано',ASSIGNED:'Назначено',READY:'Готово',RUNNING:'В работе',PAUSED:'Пауза',BLOCKED:'Блок',PARTIALLY_COMPLETED:'Частично',COMPLETED:'Готово',CANCELLED:'Отменено'}[v] ?? v);
const statusClass = (v:string) => v === 'COMPLETED' ? 'status-ok' : ['RUNNING','PAUSED','PARTIALLY_COMPLETED'].includes(v) ? 'status-warning' : ['BLOCKED','CANCELLED'].includes(v) ? 'status-danger' : 'status-neutral';

export async function mountDispatchGanttPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;
  const host = document.createElement('section');
  host.className = 'panel dispatch-gantt-page';
  host.innerHTML = '<div class="panel-head"><div><h2>Диспетчеризация · Gantt</h2><div class="subtle">Плановый горизонт по оборудованию · данные обновляются автоматически</div></div><button class="primary" data-gantt-refresh>Обновить</button></div><div data-gantt-body><div class="subtle">Загрузка…</div></div>';
  root.appendChild(host);
  const body = host.querySelector<HTMLElement>('[data-gantt-body]')!;
  let stopped = false;
  const render = async () => {
    const [tasksQ, ordersQ, assignmentsQ, equipmentQ] = await Promise.all([
      client.from('production_tasks').select('id,order_id,operation_sequence,status,planned_quantity,actual_quantity,planned_start,planned_end').neq('status','CANCELLED').order('planned_start',{ascending:true}).limit(500),
      client.from('production_orders').select('id,number,priority,due_at').limit(500),
      client.from('task_assignments').select('task_id,equipment_id,employee_id').limit(1500),
      client.from('equipment').select('id,code,name,work_center').eq('active',true).order('name',{ascending:true})
    ]);
    if (tasksQ.error) throw tasksQ.error; if (ordersQ.error) throw ordersQ.error; if (assignmentsQ.error) throw assignmentsQ.error; if (equipmentQ.error) throw equipmentQ.error;
    const tasks=(tasksQ.data??[]) as TaskRow[]; const orders=(ordersQ.data??[]) as OrderRow[]; const assignments=(assignmentsQ.data??[]) as AssignmentRow[]; const equipment=(equipmentQ.data??[]) as EquipmentRow[];
    const assignmentByTask = new Map<string,AssignmentRow>();
    for (const a of assignments) if (!assignmentByTask.has(a.task_id)) assignmentByTask.set(a.task_id,a);
    const horizonStart = Date.now();
    const first = tasks.length ? Math.min(horizonStart, ...tasks.map(t=>new Date(t.planned_start).getTime())) : horizonStart;
    const horizonEnd = tasks.length ? Math.max(horizonStart + 24*3600000, ...tasks.map(t=>new Date(t.planned_end).getTime())) : horizonStart + 24*3600000;
    const span = Math.max(3600000, horizonEnd-first);
    const rows = equipment.map(eq => {
      const eqTasks = tasks.filter(t => assignmentByTask.get(t.id)?.equipment_id === eq.id);
      const bars = eqTasks.map(t => {
        const start = new Date(t.planned_start).getTime(); const end = new Date(t.planned_end).getTime();
        const left = Math.max(0, Math.min(100, ((start-first)/span)*100)); const width = Math.max(1, Math.min(100-left, ((end-start)/span)*100));
        const order = orders.find(o=>o.id===t.order_id);
        return `<div class="gantt-bar ${statusClass(t.status)}" style="left:${left}%;width:${width}%" title="${esc(t.id)} · ${esc(order?.number??t.order_id)} · ${esc(statusLabel(t.status))}"><strong>${esc(order?.number??t.order_id)}</strong><span>${esc(t.id)} · оп.${t.operation_sequence}</span></div>`;
      }).join('');
      return `<div class="gantt-row"><div class="gantt-resource"><strong>${esc(eq.name)}</strong><span>${esc(eq.code)} · ${esc(eq.work_center)}</span></div><div class="gantt-track"><div class="gantt-grid-lines"></div>${bars||'<span class="subtle gantt-empty">Нет заданий</span>'}</div></div>`;
    }).join('');
    const unassigned = tasks.filter(t=>!assignmentByTask.get(t.id)?.equipment_id).slice(0,30).map(t=>`<span class="status-pill ${statusClass(t.status)}">${esc(t.id)}</span>`).join('');
    body.innerHTML = `<div class="gantt-scale"><span>${new Date(first).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>${new Date((first+horizonEnd)/2).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>${new Date(horizonEnd).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></div><div class="gantt-list">${rows||'<div class="subtle">Активного оборудования нет</div>'}</div><div class="gantt-unassigned"><strong>Без оборудования (${tasks.filter(t=>!assignmentByTask.get(t.id)?.equipment_id).length})</strong><div>${unassigned||'<span class="subtle">Нет</span>'}</div></div>`;
  };
  const rerender = () => { if (!stopped) void render().catch(error => { body.innerHTML = `<div class="detail-error">${esc(error instanceof Error?error.message:'Ошибка Gantt')}</div>`; }); };
  host.querySelector<HTMLButtonElement>('[data-gantt-refresh]')?.addEventListener('click',rerender);
  const unsubscribe = subscribeMesRealtime(client,{tables:['production_tasks','task_assignments','production_orders','equipment_blocks','maintenance_orders'],onChange:rerender});
  await render();
  void Promise.resolve().finally(() => { if (stopped) unsubscribe(); });
}
