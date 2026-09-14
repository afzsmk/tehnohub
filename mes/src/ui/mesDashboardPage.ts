import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { subscribeMesRealtime } from '../integration/mesRealtime';

interface OrderRow { id:string; number:string; status:string; quantity:number; completed_quantity:number; due_at:string; priority:string; }
interface TaskRow { id:string; order_id:string; status:string; planned_quantity:number; actual_quantity:number; planned_start:string; planned_end:string; actual_start:string|null; actual_end:string|null; quality_required:boolean; quality_status:string; }
interface AssignmentRow { task_id:string; employee_id:string|null; }
interface EmployeeRow { id:string; name:string; }
interface EmployeeScheduleRow { employee_id:string; date:string; shift_ids:unknown; status:string; }
interface ShiftRow { id:string; name:string; start_minute:number; duration_minutes:number; active:boolean; }
interface ProductionEventRow { task_id:string|null; type:string; occurred_at:string; }
interface DowntimeRow { id:string; equipment_id:string; reason_code:string; started_at:string; ended_at:string|null; }
interface ResultRow { task_id:string; good_quantity:number; scrap_quantity:number; recorded_at:string; }
interface MaintenanceRow { equipment_id:string; planned_start:string; planned_end:string; status:string; }
interface EquipmentRow { id:string; code:string; name:string; }

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch] ?? ch)); }
function pct(value:number, total:number): string { return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'; }
function dt(value:string): string { return new Date(value).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
function hours(ms:number): number { return ms / 3_600_000; }
function dateKey(value:string): string { return new Date(value).toISOString().slice(0,10); }
function parseShiftIds(value:unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') { try { const parsed=JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
  return [];
}
function taskActiveMs(task:TaskRow, events:ProductionEventRow[], now:number): number {
  const ordered=events.filter(event=>event.task_id===task.id).sort((a,b)=>new Date(a.occurred_at).getTime()-new Date(b.occurred_at).getTime());
  let activeStart:number|null=null;
  let total=0;
  for(const event of ordered){
    const at=new Date(event.occurred_at).getTime();
    if(!Number.isFinite(at)) continue;
    if(event.type==='TASK_STARTED'||event.type==='TASK_RESUMED'){
      if(activeStart===null) activeStart=at;
    } else if(event.type==='TASK_PAUSED'||event.type==='TASK_BLOCKED'||event.type==='TASK_COMPLETED'){
      if(activeStart!==null){ total+=Math.max(0,at-activeStart); activeStart=null; }
    }
  }
  if(activeStart!==null && task.status==='RUNNING') total+=Math.max(0,now-activeStart);
  if(total===0 && task.actual_start){
    const start=new Date(task.actual_start).getTime();
    const end=task.actual_end ? new Date(task.actual_end).getTime() : (task.status==='RUNNING' ? now : NaN);
    if(Number.isFinite(start)&&Number.isFinite(end)) total=Math.max(0,end-start);
  }
  return total;
}

export async function mountMesDashboardPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;

  const host=document.createElement('section');
  host.className='panel mes-dashboard-page';
  root.appendChild(host);

  const render=async():Promise<void>=>{
    try {
      const [ordersQ, tasksQ, assignmentsQ, employeesQ, schedulesQ, shiftsQ, eventsQ, downtimeQ, resultsQ, maintenanceQ, equipmentQ] = await Promise.all([
        client.from('production_orders').select('id,number,status,quantity,completed_quantity,due_at,priority').order('due_at',{ascending:true}),
        client.from('production_tasks').select('id,order_id,status,planned_quantity,actual_quantity,planned_start,planned_end,actual_start,actual_end,quality_required,quality_status').order('planned_start',{ascending:true}),
        client.from('task_assignments').select('task_id,employee_id').limit(5000),
        client.from('employees').select('id,name').eq('active',true).order('name',{ascending:true}),
        client.from('employee_schedules').select('employee_id,date,shift_ids,status').eq('status','WORK').limit(10000),
        client.from('shift_definitions').select('id,name,start_minute,duration_minutes,active').eq('active',true).order('start_minute',{ascending:true}),
        client.from('production_events').select('task_id,type,occurred_at').order('occurred_at',{ascending:true}).limit(20000),
        client.from('downtime_events').select('id,equipment_id,reason_code,started_at,ended_at').order('started_at',{ascending:false}),
        client.from('production_results').select('task_id,good_quantity,scrap_quantity,recorded_at').order('recorded_at',{ascending:false}),
        client.from('maintenance_orders').select('equipment_id,planned_start,planned_end,status').order('planned_start',{ascending:true}),
        client.from('equipment').select('id,code,name').order('name',{ascending:true})
      ]);
      for(const q of [ordersQ,tasksQ,assignmentsQ,employeesQ,schedulesQ,shiftsQ,eventsQ,downtimeQ,resultsQ,maintenanceQ,equipmentQ])if(q.error)throw q.error;

      const orders=(ordersQ.data??[]) as OrderRow[];
      const tasks=(tasksQ.data??[]) as TaskRow[];
      const assignments=(assignmentsQ.data??[]) as AssignmentRow[];
      const employees=(employeesQ.data??[]) as EmployeeRow[];
      const schedules=(schedulesQ.data??[]) as EmployeeScheduleRow[];
      const shifts=(shiftsQ.data??[]) as ShiftRow[];
      const productionEvents=(eventsQ.data??[]) as ProductionEventRow[];
      const downtimes=(downtimeQ.data??[]) as DowntimeRow[];
      const results=(resultsQ.data??[]) as ResultRow[];
      const maintenance=(maintenanceQ.data??[]) as MaintenanceRow[];
      const equipment=(equipmentQ.data??[]) as EquipmentRow[];

      const employeeIdsByTask=new Map<string,string[]>();
      for(const item of assignments){
        if(!item.employee_id) continue;
        const ids=employeeIdsByTask.get(item.task_id)??[];
        if(!ids.includes(item.employee_id)) ids.push(item.employee_id);
        employeeIdsByTask.set(item.task_id,ids);
      }
      const shiftDurationById=new Map(shifts.map(shift=>[shift.id,Math.max(0,Number(shift.duration_minutes||0))*60_000]));
      const taskActualMsById=new Map(tasks.map(task=>[task.id,taskActiveMs(task,productionEvents,Date.now())]));
      const taskPlannedMsById=new Map(tasks.map(task=>[task.id,Math.max(0,new Date(task.planned_end).getTime()-new Date(task.planned_start).getTime())]));

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

      const horizonTasks=tasks.filter(task=>Number.isFinite(new Date(task.planned_start).getTime())&&Number.isFinite(new Date(task.planned_end).getTime()));
      const horizonStart=horizonTasks.length?dateKey(horizonTasks.reduce((min,task)=>new Date(task.planned_start)<new Date(min)?task.planned_start:min,horizonTasks[0].planned_start)):null;
      const horizonEnd=horizonTasks.length?dateKey(horizonTasks.reduce((max,task)=>new Date(task.planned_end)>new Date(max)?task.planned_end:max,horizonTasks[0].planned_end)):null;
      const scheduledMsByEmployee=new Map<string,number>();
      if(horizonStart&&horizonEnd){
        for(const row of schedules){
          if(row.date<horizonStart||row.date>horizonEnd) continue;
          const duration=parseShiftIds(row.shift_ids).reduce((sum,shiftId)=>sum+(shiftDurationById.get(shiftId)??0),0);
          scheduledMsByEmployee.set(row.employee_id,(scheduledMsByEmployee.get(row.employee_id)??0)+duration);
        }
      }
      const employeeLoad=employees.map(employee=>{
        const employeeTaskIds=tasks.filter(task=>(employeeIdsByTask.get(task.id)??[]).includes(employee.id)&&task.status!=='CANCELLED').map(task=>task.id);
        const plannedMs=employeeTaskIds.reduce((sum,taskId)=>sum+(taskPlannedMsById.get(taskId)??0),0);
        const actualMs=employeeTaskIds.reduce((sum,taskId)=>sum+(taskActualMsById.get(taskId)??0),0);
        const scheduledMs=scheduledMsByEmployee.get(employee.id)??0;
        const activeCount=employeeTaskIds.filter(taskId=>!['COMPLETED'].includes(tasks.find(task=>task.id===taskId)?.status??'')).length;
        return {employee,plannedHours:hours(plannedMs),actualHours:hours(actualMs),scheduledHours:hours(scheduledMs),utilizationPct:scheduledMs>0?actualMs/scheduledMs*100:0,activeCount};
      }).filter(item=>item.plannedHours>0||item.actualHours>0||item.scheduledHours>0)
        .sort((a,b)=>b.utilizationPct-a.utilizationPct||b.actualHours-a.actualHours);
      const totalActualEmployeeHours=employeeLoad.reduce((sum,item)=>sum+item.actualHours,0);
      const totalPlannedEmployeeHours=employeeLoad.reduce((sum,item)=>sum+item.plannedHours,0);
      const totalScheduledEmployeeHours=employeeLoad.reduce((sum,item)=>sum+item.scheduledHours,0);
      const totalUtilizationPct=totalScheduledEmployeeHours>0?totalActualEmployeeHours/totalScheduledEmployeeHours*100:0;

      const equipmentName=new Map(equipment.map(e=>[e.id,e.name]));
      const activeDowntimeRows=downtimes.filter(d=>!d.ended_at).slice(0,8).map(d=>`<tr><td>${esc(equipmentName.get(d.equipment_id)??d.equipment_id)}</td><td>${esc(d.reason_code)}</td><td>${dt(d.started_at)}</td></tr>`).join('');
      const riskTasks=tasks.filter(t=>t.status==='BLOCKED'||(t.quality_required&&t.quality_status==='REJECTED')).slice(0,8).map(t=>`<tr><td><strong>${esc(t.id)}</strong><div class="subtle">Заказ ${esc(t.order_id)}</div></td><td>${esc(t.status)}</td><td>${t.quality_required?esc(t.quality_status):'—'}</td></tr>`).join('');
      const dueRows=orders.filter(o=>!['COMPLETED','CANCELLED'].includes(o.status)).slice(0,8).map(o=>`<tr><td><strong>${esc(o.number)}</strong></td><td>${esc(o.status)}</td><td>${dt(o.due_at)}</td><td>${esc(o.priority)}</td></tr>`).join('');
      const upcomingMaintenance=maintenance.filter(m=>m.status==='PLANNED'&&new Date(m.planned_end).getTime()>=now).slice(0,8).map(m=>`<tr><td>${esc(equipmentName.get(m.equipment_id)??m.equipment_id)}</td><td>${dt(m.planned_start)}</td><td>${dt(m.planned_end)}</td></tr>`).join('');
      const loadRows=employeeLoad.slice(0,12).map(item=>`<tr><td><strong>${esc(item.employee.name)}</strong></td><td>${item.actualHours.toFixed(1)} ч</td><td>${item.plannedHours.toFixed(1)} ч</td><td>${item.scheduledHours.toFixed(1)} ч</td><td>${item.scheduledHours>0?item.utilizationPct.toFixed(1)+'%':'—'}</td><td>${item.activeCount}</td></tr>`).join('');

      host.innerHTML=`<div class="panel-head"><div><h2>Оперативный Dashboard Plan / Fact</h2><div class="subtle">Смена · производство · риски · качество · простои</div></div><button class="primary" data-dashboard-refresh>Обновить</button></div>
        <div class="dashboard-kpis">
          <article><span>Выполнение плана</span><strong>${completionRate}</strong><small>${factQty} / ${planQty}</small></article>
          <article><span>Активные задания</span><strong>${activeTasks.length}</strong><small>запущено: ${runningTasks}</small></article>
          <article><span>Готовые задания</span><strong>${completedTasks}</strong><small>из ${tasks.length}</small></article>
          <article class="${overdue?'dashboard-danger':''}"><span>Просроченные заказы</span><strong>${overdue}</strong><small>из ${orders.length}</small></article>
          <article class="${openDowntimes?'dashboard-warning':''}"><span>Открытые простои</span><strong>${openDowntimes}</strong><small>оборудование</small></article>
          <article class="${qualityPending||qualityRejected?'dashboard-warning':''}"><span>Риски ОТК</span><strong>${qualityPending+qualityRejected}</strong><small>ожидают: ${qualityPending} · отклонены: ${qualityRejected}</small></article>
          <article><span>Годная продукция</span><strong>${goodQty}</strong><small>факт</small></article>
          <article class="${scrapQty?'dashboard-warning':''}"><span>Брак</span><strong>${scrapQty}</strong><small>${scrapRate}</small></article>
          <article class="${totalUtilizationPct>=100?'dashboard-warning':''}"><span>Personnel utilization</span><strong>${totalScheduledEmployeeHours>0?totalUtilizationPct.toFixed(1)+'%':'—'}</strong><small>${totalActualEmployeeHours.toFixed(1)} / ${totalScheduledEmployeeHours.toFixed(1)} ч факта к рабочей ёмкости</small></article>
        </div>
        <div class="dashboard-grid">
          <div class="dashboard-card"><div class="dashboard-card-head"><h3>Заказы под риском / ближайшие</h3><span>${overdue} просрочено</span></div><table><thead><tr><th>Заказ</th><th>Статус</th><th>Срок</th><th>Приоритет</th></tr></thead><tbody>${dueRows||'<tr><td colspan="4">Нет активных заказов</td></tr>'}</tbody></table></div>
          <div class="dashboard-card"><div class="dashboard-card-head"><h3>Задания под контролем</h3><span>${blockedTasks} блокировок</span></div><table><thead><tr><th>Задание</th><th>Статус</th><th>ОТК</th></tr></thead><tbody>${riskTasks||'<tr><td colspan="3">Критических заданий нет</td></tr>'}</tbody></table></div>
          <div class="dashboard-card"><div class="dashboard-card-head"><h3>Открытые простои</h3><span>${openDowntimes}</span></div><table><thead><tr><th>Оборудование</th><th>Причина</th><th>Начало</th></tr></thead><tbody>${activeDowntimeRows||'<tr><td colspan="3">Простоев нет</td></tr>'}</tbody></table></div>
          <div class="dashboard-card"><div class="dashboard-card-head"><h3>Ближайшее обслуживание</h3><span>${maintenance.filter(m=>m.status==='PLANNED').length}</span></div><table><thead><tr><th>Оборудование</th><th>Начало</th><th>Конец</th></tr></thead><tbody>${upcomingMaintenance||'<tr><td colspan="3">Планового обслуживания нет</td></tr>'}</tbody></table></div>
          <div class="dashboard-card"><div class="dashboard-card-head"><h3>Personnel utilization</h3><span>${totalScheduledEmployeeHours.toFixed(1)} ч ёмкости</span></div><div class="subtle" style="margin-bottom:8px">Факт = активное время между START/RESUME и PAUSE/BLOCK/COMPLETE. Ёмкость = рабочие смены сотрудника в горизонте плановых заданий. При совместном назначении операция учитывается полностью каждому назначенному сотруднику.</div><table><thead><tr><th>Сотрудник</th><th>Факт, ч</th><th>План, ч</th><th>Ёмкость, ч</th><th>Utilization</th><th>Активных</th></tr></thead><tbody>${loadRows||'<tr><td colspan="6">Нет данных по загрузке персонала</td></tr>'}</tbody></table></div>
        </div>`;
      host.querySelector<HTMLButtonElement>('[data-dashboard-refresh]')?.addEventListener('click',()=>void render());
    } catch(error) {
      host.innerHTML=`<div class="detail-error">${esc(error instanceof Error?error.message:'Ошибка загрузки Dashboard')}</div>`;
    }
  };

  subscribeMesRealtime(client,{tables:['production_orders','production_tasks','task_assignments','employees','employee_schedules','shift_definitions','production_events','production_results','downtime_events','maintenance_orders','equipment'],debounceMs:500,onChange:()=>void render()});
  await render();
}
