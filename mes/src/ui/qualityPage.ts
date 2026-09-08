import type { SupabaseClient } from '@supabase/supabase-js';
import type { QualityStatus, UserRole } from '../types';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesQualityRpc } from '../integration/mesQualityRpc';

type TaskRow = { id:string; order_id:string; operation_sequence:number; status:string; planned_quantity:number; actual_quantity:number; quality_required:boolean; quality_status:QualityStatus; };
type InspectionRow = { task_id:string; inspected_at:string; status:'PENDING'|'APPROVED'|'REJECTED'; defect_code:string|null; comment:string|null; };
function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch] ?? ch)); }
function qualityLabel(status: QualityStatus): string { return status === 'APPROVED' ? 'Принято' : status === 'REJECTED' ? 'Отклонено' : status === 'PENDING' ? 'Ожидает ОТК' : 'Не требуется'; }

export async function mountQualityPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  const role = auth.identity?.role as UserRole | undefined;
  if (!role) return;
  const canRequest = ['OPERATOR','MASTER','QUALITY','ADMIN','PRODUCTION_MANAGER'].includes(role);
  const canInspect = ['QUALITY','ADMIN','PRODUCTION_MANAGER'].includes(role);
  const canConfigure = ['ADMIN','PRODUCTION_MANAGER','PLANNER','MASTER'].includes(role);

  const [{ data: taskData, error: taskError }, { data: inspectionData, error: inspectionError }] = await Promise.all([
    client.from('production_tasks').select('id,order_id,operation_sequence,status,planned_quantity,actual_quantity,quality_required,quality_status').order('planned_start', { ascending:true }),
    client.from('quality_inspections').select('task_id,inspected_at,status,defect_code,comment').order('inspected_at', { ascending:false })
  ]);
  if (taskError) throw taskError; if (inspectionError) throw inspectionError;
  const tasks=(Array.isArray(taskData)?taskData:[]) as TaskRow[];
  const inspections=(Array.isArray(inspectionData)?inspectionData:[]) as InspectionRow[];
  const latest=new Map<string,InspectionRow>(); for(const item of inspections) if(!latest.has(item.task_id)) latest.set(item.task_id,item);
  const pending=tasks.filter(t=>t.quality_required&&t.quality_status==='PENDING').length;

  const host=document.createElement('section'); host.className='panel quality-page';
  host.innerHTML=`<div class="panel-head"><div><h2>ОТК / контроль качества</h2><div class="subtle">${pending} заданий ожидают решения · ${role}</div></div></div>
    <div class="execution-table-wrap"><table><thead><tr><th>Задание</th><th>Статус</th><th>Факт / план</th><th>Последний контроль</th><th>Действие</th></tr></thead><tbody>${tasks.map(task=>{
      const inspection=latest.get(task.id);
      let action='—';
      if(task.quality_required){
        if(task.quality_status==='PENDING'&&canInspect) action=`<button class="tiny" data-quality-review="${esc(task.id)}">Открыть проверку</button>`;
        else if(canRequest&&task.quality_status!=='PENDING'&&!['COMPLETED','CANCELLED'].includes(task.status)) action=`<button class="tiny" data-quality-request="${esc(task.id)}">Запросить ОТК</button>`;
      } else if(canConfigure&&!['COMPLETED','CANCELLED'].includes(task.status)) action=`<button class="tiny" data-quality-config="${esc(task.id)}">Включить ОТК</button>`;
      const toggle=task.quality_required&&canConfigure&&!['COMPLETED','CANCELLED'].includes(task.status) ? `<button class="tiny" data-quality-config="${esc(task.id)}">Отключить ОТК</button>` : '';
      return `<tr><td><strong>${esc(task.id)}</strong><div class="subtle">Заказ ${esc(task.order_id)} · оп. ${task.operation_sequence}</div></td><td>${task.quality_required?qualityLabel(task.quality_status):'Не требуется'}</td><td>${Number(task.actual_quantity)} / ${Number(task.planned_quantity)}</td><td>${inspection?new Date(inspection.inspected_at).toLocaleString('ru-RU')+(inspection.defect_code?`<div class="subtle">дефект: ${esc(inspection.defect_code)}</div>`:''):'—'}</td><td>${action} ${toggle}</td></tr>`;
    }).join('')||'<tr><td colspan="5">Производственных заданий нет</td></tr>'}</tbody></table></div>
    <form id="quality-page-form" class="result-form" hidden><h3>Решение ОТК</h3><input type="hidden" name="task"><select name="status"><option value="APPROVED">Принято</option><option value="REJECTED">Отклонено</option></select><input name="good" type="number" min="0" step="1" value="1" required placeholder="Годное по результату контроля"><input name="scrap" type="number" min="0" step="1" value="0" required placeholder="Брак по результату контроля"><input name="defect" placeholder="Код дефекта (обязательно при отклонении)"><input name="comment" placeholder="Комментарий ОТК"><button class="primary" type="submit">Зафиксировать решение</button></form>`;
  root.appendChild(host);
  const rpc=new SupabaseMesQualityRpc(client);
  host.querySelectorAll<HTMLButtonElement>('[data-quality-config]').forEach(button=>button.addEventListener('click',async()=>{const task=tasks.find(t=>t.id===button.dataset.qualityConfig);if(!task)return;try{await rpc.setQualityRequired(task.id,!task.quality_required);window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось изменить требование ОТК');}}));
  host.querySelectorAll<HTMLButtonElement>('[data-quality-request]').forEach(button=>button.addEventListener('click',async()=>{try{await rpc.requestQualityCheck(button.dataset.qualityRequest??'');window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось отправить запрос ОТК');}}));
  host.querySelectorAll<HTMLButtonElement>('[data-quality-review]').forEach(button=>button.addEventListener('click',()=>{const form=host.querySelector<HTMLFormElement>('#quality-page-form');if(!form)return;form.hidden=false;(form.elements.namedItem('task') as HTMLInputElement).value=button.dataset.qualityReview??'';form.scrollIntoView({behavior:'smooth',block:'center'});}));
  host.querySelector<HTMLFormElement>('#quality-page-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement);try{await rpc.submitQualityInspection(String(data.get('task')??''),String(data.get('status')??'APPROVED') as 'APPROVED'|'REJECTED',Number(data.get('good')??0),Number(data.get('scrap')??0),String(data.get('defect')??''),String(data.get('comment')??''),new Date().toISOString());window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось сохранить решение ОТК');}});
}
