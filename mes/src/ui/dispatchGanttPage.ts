import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesPlanningRpc, MesResourceRecommendation } from '../integration/mesPlanningRpc';
import { MesReplanChange, SupabaseMesReplanRpc } from '../integration/mesReplanRpc';
import { subscribeMesRealtime } from '../integration/mesRealtime';

type TaskRow = { id:string; order_id:string; operation_sequence:number; status:string; planned_quantity:number; actual_quantity:number; planned_start:string; planned_end:string; version:number; };
type OrderRow = { id:string; plan_id:string; number:string; priority:string; due_at:string; };
type AssignmentRow = { task_id:string; equipment_id:string|null; employee_id:string|null };
type EquipmentRow = { id:string; code:string; name:string; work_center:string; };

const esc = (v:unknown) => String(v ?? '').replace(/[&<>\\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[c] ?? c));
const statusLabel = (v:string) => ({PLANNED:'Запланировано',ASSIGNED:'Назначено',READY:'Готово',RUNNING:'В работе',PAUSED:'Пауза',BLOCKED:'Блок',PARTIALLY_COMPLETED:'Частично',COMPLETED:'Готово',CANCELLED:'Отменено'}[v] ?? v);
const statusClass = (v:string) => v === 'COMPLETED' ? 'status-ok' : ['RUNNING','PAUSED','PARTIALLY_COMPLETED'].includes(v) ? 'status-warning' : ['BLOCKED','CANCELLED'].includes(v) ? 'status-danger' : 'status-neutral';
const canDrag = (status:string) => ['PLANNED','ASSIGNED','READY','BLOCKED'].includes(status);
const MINUTE_MS = 60_000;
function snapMinutes(value:number): number { return Math.round(value / 15) * 15; }
function toIso(value:number): string { return new Date(value).toISOString(); }

export async function mountDispatchGanttPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;
  const host = document.createElement('section');
  host.className = 'panel dispatch-gantt-page';
  host.innerHTML = '<div class="panel-head"><div><h2>Диспетчеризация · Gantt</h2><div class="subtle">Drag & drop · шаг 15 минут · серверная проверка конфликтов и версии плана</div></div><button class="primary" data-gantt-refresh>Обновить</button></div><div data-gantt-body><div class="subtle">Загрузка…</div></div>';
  root.appendChild(host);
  const body = host.querySelector<HTMLElement>('[data-gantt-body]')!;
  const replanRpc = new SupabaseMesReplanRpc(client);
  const planningRpc = new SupabaseMesPlanningRpc(client);
  let rendering = false;
  let dragTask: { id:string; start:number; end:number; version:number } | null = null;
  let recommendationTaskId = '';
  let recommendationTaskVersion = 0;
  let recommendationBusy = false;

  const showRecommendations = async (taskId:string, taskVersion:number): Promise<void> => {
    if (recommendationBusy) return;
    recommendationBusy = true;
    recommendationTaskId = taskId;
    recommendationTaskVersion = taskVersion;
    const panel = host.querySelector<HTMLElement>('[data-recommendations]');
    if (!panel) { recommendationBusy = false; return; }
    panel.innerHTML = '<div class="subtle">Подбираем допустимый комплект ресурсов…</div>';
    panel.hidden = false;
    try {
      const taskQ = await client.from('production_tasks').select('operation_id').eq('id',taskId).single();
      if (taskQ.error) throw taskQ.error;
      const opQ = await client.from('route_operations').select('workers_required,required_equipment_ids').eq('id',String(taskQ.data?.operation_id??'')).single();
      if (opQ.error) throw opQ.error;
      const workersRequired = Math.max(1,Number(opQ.data?.workers_required??1));
      const requiredEquipment = Array.isArray(opQ.data?.required_equipment_ids) ? opQ.data.required_equipment_ids as string[] : [];
      const rows = await planningRpc.recommendResources(taskId);
      const employees = rows.filter(r => r.resourceType === 'EMPLOYEE').slice(0, 20);
      const equipment = rows.filter(r => r.resourceType === 'EQUIPMENT').slice(0, 5);
      const selectedEmployees = new Set<string>();
      let selectedEquipment = '';
      const renderGroup = (title:string, type:'EMPLOYEE'|'EQUIPMENT', items:MesResourceRecommendation[]) =>
        '<div class="recommend-group"><strong>'+title+'</strong>'+
        (items.length ? items.map(item => '<div class="recommend-item"><div><b>'+esc(item.resourceName)+'</b><small>score '+item.score.toFixed(1)+' · '+esc(item.reasons.slice(0,3).join(' · '))+'</small></div><button class="tiny" type="button" data-select-recommend data-resource-type="'+type+'" data-resource-id="'+esc(item.resourceId)+'">Выбрать</button></div>').join('') : '<div class="subtle">Подходящих ресурсов не найдено</div>')+
        '</div>';
      panel.innerHTML =
        '<div class="recommend-head"><div><strong>Подбор ресурсов для '+esc(taskId)+'</strong><div class="subtle">Требуется работников: '+workersRequired+' · оборудование: '+(requiredEquipment.length?'обязательно':'по необходимости')+'.</div></div><button class="tiny" data-close-recommendations>Закрыть</button></div>'+
        '<div class="recommend-grid">'+renderGroup('Сотрудники','EMPLOYEE',employees)+renderGroup('Оборудование','EQUIPMENT',equipment)+'</div>'+
        '<div class="recommend-actions"><span class="subtle" data-recommend-selection>Выбрано: 0/'+workersRequired+' сотрудников'+(requiredEquipment.length?' · оборудование не выбрано':'')+'</span><button class="primary" type="button" data-assign-recommend-set disabled>Назначить комплект</button></div>';
      const selection = panel.querySelector<HTMLElement>('[data-recommend-selection]');
      const action = panel.querySelector<HTMLButtonElement>('[data-assign-recommend-set]');
      const refreshSelection = () => {
        const employeeText=selectedEmployees.size+'/'+workersRequired+' сотрудников';
        const equipmentText=requiredEquipment.length?(selectedEquipment?' · оборудование выбрано':' · оборудование не выбрано'):'';
        if(selection) selection.textContent='Выбрано: '+employeeText+equipmentText;
        const canAssign=selectedEmployees.size>=Math.min(workersRequired,employees.length) &&
          (!requiredEquipment.length||!!selectedEquipment);
        if(action)action.disabled=!canAssign;
        panel.querySelectorAll<HTMLButtonElement>('[data-select-recommend]').forEach(button=>{
          const type=button.dataset.resourceType;
          const id=button.dataset.resourceId??'';
          const active=type==='EMPLOYEE'?selectedEmployees.has(id):id===selectedEquipment;
          button.textContent=active?'Выбрано':'Выбрать';
          button.classList.toggle('primary',active);
        });
      };
      panel.querySelectorAll<HTMLButtonElement>('[data-select-recommend]').forEach(button=>button.addEventListener('click',()=>{
        const type=button.dataset.resourceType;
        const id=button.dataset.resourceId??'';
        if(!id)return;
        if(type==='EMPLOYEE'){
          if(selectedEmployees.has(id))selectedEmployees.delete(id);
          else if(selectedEmployees.size<workersRequired)selectedEmployees.add(id);
        }else if(type==='EQUIPMENT'){
          selectedEquipment=selectedEquipment===id?'':id;
        }
        refreshSelection();
      }));
      action?.addEventListener('click',async()=>{
        if(!recommendationTaskId||recommendationTaskVersion<=0)return;
        action.disabled=true;
        const selectedTaskId=recommendationTaskId;
        const expectedVersion=recommendationTaskVersion;
        try{
          await planningRpc.assignTask(
            selectedTaskId,
            {employeeIds:[...selectedEmployees],equipmentIds:selectedEquipment?[selectedEquipment]:undefined},
            expectedVersion
          );
          recommendationTaskId='';recommendationTaskVersion=0;
          panel.hidden=true;panel.innerHTML='';
          await render();
        }catch(error){
          action.disabled=false;
          panel.insertAdjacentHTML('afterbegin','<div class="detail-error">'+esc(error instanceof Error?error.message:'Комплект не назначен')+'</div>');
        }
      });
      panel.querySelector<HTMLButtonElement>('[data-close-recommendations]')?.addEventListener('click',()=>{panel.hidden=true;});
      refreshSelection();
    } catch (error) {
      panel.innerHTML = '<div class="detail-error">'+esc(error instanceof Error ? error.message : 'Не удалось получить рекомендации')+'</div>';
    } finally { recommendationBusy = false; }
  };

  const applyMove = async (task: { id:string; start:number; end:number; version:number }, targetStart:number, planId:string, planVersion:number): Promise<void> => {
    const delta = snapMinutes((targetStart - task.start) / MINUTE_MS);
    if (!delta) return;
    const change: MesReplanChange = { taskId:task.id, proposedStart:toIso(task.start + delta * MINUTE_MS), proposedEnd:toIso(task.end + delta * MINUTE_MS), expectedVersion:task.version };
    const refresh = host.querySelector<HTMLButtonElement>('[data-gantt-refresh]');
    if (refresh) refresh.disabled = true;
    try { await replanRpc.apply(planId, planVersion, [change]); await render(); }
    catch (error) { body.insertAdjacentHTML('afterbegin', `<div class="detail-error gantt-error">${esc(error instanceof Error ? error.message : 'Не удалось перенести задание')}</div>`); }
    finally { if (refresh) refresh.disabled = false; }
  };

  const attachDragHandlers = (planId:string, planVersion:number, first:number, span:number) => {
    host.querySelectorAll<HTMLElement>('.gantt-draggable').forEach(bar => {
      bar.addEventListener('dragstart', event => {
        dragTask = { id:bar.dataset.taskId ?? '', start:Number(bar.dataset.start), end:Number(bar.dataset.end), version:Number(bar.dataset.version) };
        bar.classList.add('gantt-dragging');
        event.dataTransfer?.setData('text/plain', dragTask.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      bar.addEventListener('dragend', () => { bar.classList.remove('gantt-dragging'); dragTask = null; });
    });
    host.querySelectorAll<HTMLElement>('.gantt-track').forEach(track => {
      track.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; });
      track.addEventListener('drop', event => {
        event.preventDefault();
        if (!dragTask || !dragTask.id) return;
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        void applyMove(dragTask, first + ratio * span, planId, planVersion);
      });
    });
  };

  const render = async () => {
    if (rendering) return;
    rendering = true;
    try {
      const [tasksQ, ordersQ, assignmentsQ, equipmentQ, planQ] = await Promise.all([
        client.from('production_tasks').select('id,order_id,operation_sequence,status,planned_quantity,actual_quantity,planned_start,planned_end,version').neq('status','CANCELLED').order('planned_start',{ascending:true}).limit(500),
        client.from('production_orders').select('id,plan_id,number,priority,due_at').limit(500),
        client.from('task_assignments').select('task_id,equipment_id,employee_id').limit(1500),
        client.from('equipment').select('id,code,name,work_center').eq('active',true).order('name',{ascending:true}),
        client.from('operational_plans').select('id,version,horizon_start,horizon_end,status,created_at').neq('status','ARCHIVED').order('created_at',{ascending:false}).limit(1).maybeSingle()
      ]);
      if (tasksQ.error) throw tasksQ.error;
      if (ordersQ.error) throw ordersQ.error;
      if (assignmentsQ.error) throw assignmentsQ.error;
      if (equipmentQ.error) throw equipmentQ.error;
      if (planQ.error) throw planQ.error;
      const tasks = (tasksQ.data ?? []) as TaskRow[];
      const orders = (ordersQ.data ?? []) as OrderRow[];
      const assignments = (assignmentsQ.data ?? []) as AssignmentRow[];
      const equipment = (equipmentQ.data ?? []) as EquipmentRow[];
      const plan = planQ.data as {id:string; version:number; horizon_start:string; horizon_end:string; status:string}|null;
      const planOrderIds = new Set(orders.filter(o=>!plan || o.plan_id===plan.id).map(o=>o.id));
      const activeTasks = tasks.filter(t=>planOrderIds.has(t.order_id));
      const assignmentByTask = new Map<string,AssignmentRow>();
      for (const a of assignments) if (!assignmentByTask.has(a.task_id)) assignmentByTask.set(a.task_id, a);
      const now = Date.now();
      const first = activeTasks.length ? Math.min(now, ...activeTasks.map(t=>new Date(t.planned_start).getTime())) : (plan ? new Date(plan.horizon_start).getTime() : now);
      const horizonEnd = activeTasks.length ? Math.max(now + 24*60*MINUTE_MS, ...activeTasks.map(t=>new Date(t.planned_end).getTime())) : (plan ? new Date(plan.horizon_end).getTime() : now + 24*60*MINUTE_MS);
      const span = Math.max(60*MINUTE_MS, horizonEnd - first);
      const mid = first + span / 2;
      const rows = equipment.map(eq => {
        const eqTasks = activeTasks.filter(t => assignmentByTask.get(t.id)?.equipment_id === eq.id);
        const bars = eqTasks.map(t => {
          const start = new Date(t.planned_start).getTime();
          const end = new Date(t.planned_end).getTime();
          const left = Math.max(0, Math.min(100, ((start-first)/span)*100));
          const width = Math.max(1, Math.min(100-left, ((end-start)/span)*100));
          const order = orders.find(o=>o.id===t.order_id);
          const draggable = canDrag(t.status);
          return `<div class="gantt-bar ${statusClass(t.status)} ${draggable?'gantt-draggable':''}" ${draggable?'draggable="true"':''} data-task-id="${esc(t.id)}" data-start="${start}" data-end="${end}" data-version="${t.version}" style="left:${left}%;width:${width}%" title="${esc(t.id)} · ${esc(order?.number??t.order_id)} · ${esc(statusLabel(t.status))}"><strong>${esc(order?.number??t.order_id)}</strong><span>${esc(t.id)} · оп.${t.operation_sequence}</span></div>`;
        }).join('');
        return `<div class="gantt-row"><div class="gantt-resource"><strong>${esc(eq.name)}</strong><span>${esc(eq.code)} · ${esc(eq.work_center)}</span></div><div class="gantt-track"><div class="gantt-grid-lines"></div><div class="gantt-now-line" style="left:${Math.max(0,Math.min(100,((now-first)/span)*100))}%"></div>${bars||'<span class="subtle gantt-empty">Нет заданий</span>'}</div></div>`;
      }).join('');
      const unassignedTasks = activeTasks.filter(t=>!assignmentByTask.get(t.id)?.equipment_id).slice(0,30);
      const unassigned = unassignedTasks.map(t=>`<div class="gantt-unassigned-item"><span class="status-pill ${statusClass(t.status)}">${esc(t.id)} · v${t.version}</span><button class="tiny" data-recommend-task="${esc(t.id)}" data-recommend-version="${t.version}">Подобрать ресурсы</button></div>`).join('');
      const panel = host.querySelector<HTMLElement>('[data-recommendations]');
      const panelState = panel?.hidden === false ? 'visible' : 'hidden';
      body.innerHTML = `<div class="gantt-scale"><div class="gantt-scale-resource">Оборудование</div><div class="gantt-scale-track"><span>${new Date(first).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>${new Date(mid).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>${new Date(horizonEnd).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></div></div><div class="gantt-help"><span>↔ Перетаскивание: 15 мин</span><span>● Текущее время</span><span>Версия плана: ${plan?.version ?? '—'}</span></div><div class="gantt-list">${rows||'<div class="subtle" style="padding:24px">Активного оборудования нет</div>'}</div><div class="gantt-unassigned"><strong>Без оборудования (${unassignedTasks.length})</strong><div class="gantt-unassigned-list">${unassigned||'<span class="subtle">Нет</span>'}</div></div><div data-recommendations ${panelState === 'hidden' ? 'hidden' : ''}></div>`;
      host.dataset.first = String(first);
      host.dataset.span = String(span);
      if (plan) attachDragHandlers(plan.id, Number(plan.version), first, span);
      attachRecommendationHandlers();
      host.querySelectorAll<HTMLButtonElement>('[data-recommend-task]').forEach(button => button.addEventListener('click', () => {
        const id = button.dataset.recommendTask;
        const version = Number(button.dataset.recommendVersion);
        if (id && Number.isInteger(version) && version > 0) void showRecommendations(id, version);
      }));
    } finally { rendering = false; }
  };

  host.querySelector<HTMLButtonElement>('[data-gantt-refresh]')?.addEventListener('click',()=>void render());
  subscribeMesRealtime(client,{tables:['production_tasks','task_assignments','production_orders','equipment_blocks','maintenance_orders'],onChange:()=>void render()});
  await render();
}
