import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';

interface OrderRow { id:string; number:string; status:string; quantity:number; completed_quantity:number; due_at:string; priority:string; }
interface TaskRow { id:string; order_id:string; status:string; planned_quantity:number; actual_quantity:number; planned_start:string; planned_end:string; quality_required:boolean; quality_status:string; }
interface DowntimeRow { id:string; equipment_id:string; reason_code:string; started_at:string; ended_at:string|null; }
interface ResultRow { task_id:string; good_quantity:number; scrap_quantity:number; recorded_at:string; }
interface MaintenanceRow { equipment_id:string; planned_start:string; planned_end:string; status:string; }
interface EquipmentRow { id:string; code:string; name:string; }

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch] ?? ch)); }
function pct(value:number, total:number): string { return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'; }
function dt(value:string): string { return new Date(value).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }

export async function mountMesDashboardPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;

  const [ordersQ, tasksQ, downtimeQ, resultsQ, maintenanceQ, equipmentQ] = await Promise.all([
    client.from('production_orders').select('id,number,status,quantity,completed_quantity,due_at,priority').order('due_at', { ascending:true }),
    client.from('production_tasks').select('id,order_id,status,planned_quantity,actual_quantity,planned_start,planned_end,quality_required,quality_status').order('planned_start', { ascending:true }),
    client.from('downtime_events').select('id,equipment_id,reason_code,started_at,ended_at').order('started_at', { ascending:false }),
    client.from('production_results').select('task_id,good_quantity,scrap_quantity,recorded_at').order('recorded_at', { ascending:false }),
    client.from('maintenance_orders').select('equipment_id,planned_start,planned_end,status').order('planned_start', { ascending:true }),
    client.from('equipment').select('id,code,name').order('name', { ascending:true })
  ]);
  for (const q of [ordersQ,tasksQ,downtimeQ,resultsQ,maintenanceQ,equipmentQ]) if (q.error) throw q.error;

  const orders=(ordersQ.data ?? []) as OrderRow[];
  const tasks=(tasksQ.data ?? []) as TaskRow[];
  const downtimes=(downtimeQ.data ?? []) as DowntimeRow[];
  const results=(resultsQ.data ?? []) as ResultRow[];
  const maintenance=(maintenanceQ.data ?? []) as MaintenanceRow[];
  const equipment=(equipmentQ.data ?? []) as EquipmentRow[];

  const activeTasks=tasks.filter(t=>!['COMPLETED','CANCELLED'].includes(t.status));
  const completedTasks=tasks.filter(t=>t.status==='COMPLETED').length;
  const blockedTasks=tasks.filter(t=>t.status==='BLOCKED').length;
  const runningTasks=tasks.filter(t=>t.status==='RUNNING').length;
  const planQty=tasks.reduce((s,t)=>s+Number(t.planned_quantity||0),0);
  const factQty=tasks.reduce((s,t)=>s+Number(t.actual_quantity||0),0);
  const goodQty=results.reduce((s,r)=>s+Number(r.good_quantity||0),0);
  const scrapQty=results.reduce((s,r)=>s+Number(r.scrap_quantity||0),0);
  const openDowntimes=downtimes.filter(d=>!d.ended_at).length;
  const qualityPending=tasks.filter(t=>t.quality_required&&t.quality_status==='PENDING').length;
  const qualityRejected=tasks.filter(t=>t.quality_required&&t.quality_status==='REJECTED').length;
  const now=Date.now();
  const overdue=orders.filter(o=>!['COMPLETED','CANCELLED'].includes(o.status)&&new Date(o.due_at).getTime()<now).length;
  const completionRate=pct(factQty,planQty);
  const scrapRate=pct(scrapQty,goodQty+scrapQty);

  const equipmentName=new Map(equipment.map(e=>[e.id,e.name]));
  const activeDowntimeRows=downtimes.filter(d=>!d.ended_at).slice(0,8).map(d=>`<tr><td>${esc(equipmentName.get(d.equipment_id)??d.equipment_id)}</td><td>${esc(d.reason_code)}</td><td>${dt(d.started_at)}</td></tr>`).join('');
  const riskTasks=tasks.filter(t=>t.status==='BLOCKED'||(t.quality_required&&t.quality_status==='REJECTED')).slice(0,8).map(t=>`<tr><td><strong>${esc(t.id)}</strong><div class="subtle">Заказ ${esc(t.order_id)}</div></td><td>${esc(t.status)}</td><td>${t.quality_required?esc(t.quality_status):'—'}</td></tr>`).join('');
  const dueRows=orders.filter(o=>!['COMPLETED','CANCELLED'].includes(o.status)).slice(0,8).map(o=>`<tr><td><strong>${esc(o.number)}</strong></td><td>${esc(o.status)}</td><td>${dt(o.due_at)}</td><td>${esc(o.priority)}</td></tr>`).join('');
  const upcomingMaintenance=maintenance.filter(m=>m.status==='PLANNED'&&new Date(m.planned_end).getTime()>=now).slice(0,8).map(m=>`<tr><td>${esc(equipmentName.get(m.equipment_id)??m.equipment_id)}</td><td>${dt(m.planned_start)}</td><td>${dt(m.planned_end)}</td></tr>`).join('');

  const host=document.createElement('section');
  host.className='panel mes-dashboard-page';
  host.innerHTML=`<div class="panel-head"><div><h2>Оперативный Dashboard Plan / Fact</h2><div class="subtle">Смена · производство · риски · качество · простои</div></div><button class="primary" id="mes-dashboard-refresh">Обновить</button></div>
    <div class="dashboard-kpis">
      <article><span>Выполнение плана</span><strong>${completionRate}</strong><small>${factQty} / ${planQty}</small></article>
      <article><span>Активные задания</span><strong>${activeTasks.length}</strong><small>запущено: ${runningTasks}</small></article>
      <article><span>Готовые задания</span><strong>${completedTasks}</strong><small>из ${tasks.length}</small></article>
      <article class="${overdue?'dashboard-danger':''}"><span>Просроченные заказы</span><strong>${overdue}</strong><small>из ${orders.length}</small></article>
      <article class="${openDowntimes?'dashboard-warning':''}"><span>Открытые простои</span><strong>${openDowntimes}</strong><small>оборудование</small></article>
      <article class="${qualityPending||qualityRejected?'dashboard-warning':''}"><span>Риски ОТК</span><strong>${qualityPending+qualityRejected}</strong><small>ожидают: ${qualityPending} · отклонены: ${qualityRejected}</small></article>
      <article><span>Годная продукция</span><strong>${goodQty}</strong><small>факт</small></article>
      <article class="${scrapQty?'dashboard-warning':''}"><span>Брак</span><strong>${scrapQty}</strong><small>${scrapRate}</small></article>
    </div>
    <div class="dashboard-grid">
      <div class="dashboard-card"><div class="dashboard-card-head"><h3>Заказы под риском / ближайшие</h3><span>${overdue} просрочено</span></div><table><thead><tr><th>Заказ</th><th>Статус</th><th>Срок</th><th>Приоритет</th></tr></thead><tbody>${dueRows||'<tr><td colspan="4">Нет активных заказов</td></tr>'}</tbody></table></div>
      <div class="dashboard-card"><div class="dashboard-card-head"><h3>Задания под контролем</h3><span>${blockedTasks} блокировок</span></div><table><thead><tr><th>Задание</th><th>Статус</th><th>ОТК</th></tr></thead><tbody>${riskTasks||'<tr><td colspan="3">Критических заданий нет</td></tr>'}</tbody></table></div>
      <div class="dashboard-card"><div class="dashboard-card-head"><h3>Открытые простои</h3><span>${openDowntimes}</span></div><table><thead><tr><th>Оборудование</th><th>Причина</th><th>Начало</th></tr></thead><tbody>${activeDowntimeRows||'<tr><td colspan="3">Простоев нет</td></tr>'}</tbody></table></div>
      <div class="dashboard-card"><div class="dashboard-card-head"><h3>Ближайшее обслуживание</h3><span>${maintenance.filter(m=>m.status==='PLANNED').length}</span></div><table><thead><tr><th>Оборудование</th><th>Начало</th><th>Конец</th></tr></thead><tbody>${upcomingMaintenance||'<tr><td colspan="3">Планового обслуживания нет</td></tr>'}</tbody></table></div>
    </div>`;
  root.appendChild(host);
  host.querySelector<HTMLButtonElement>('#mes-dashboard-refresh')?.addEventListener('click',()=>window.location.reload());
}
