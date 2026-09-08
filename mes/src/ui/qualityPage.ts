import type { SupabaseClient } from '@supabase/supabase-js';
import type { QualityStatus, UserRole } from '../types';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesQualityRpc } from '../integration/mesQualityRpc';

type TaskRow = { id:string; order_id:string; operation_sequence:number; status:string; planned_quantity:number; actual_quantity:number; quality_required:boolean; quality_status:QualityStatus; };
type InspectionRow = { task_id:string; inspected_at:string; status:'PENDING'|'APPROVED'|'REJECTED'; good_quantity:number; scrap_quantity:number; defect_code:string|null; comment:string|null; };
function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch] ?? ch)); }
function qualityLabel(status: QualityStatus): string { return status === 'APPROVED' ? 'Принято' : status === 'REJECTED' ? 'Отклонено' : status === 'PENDING' ? 'Ожидает ОТК' : 'Не требуется'; }
function pct(value:number, total:number): string { return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'; }

export async function mountQualityPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  const role = auth.identity?.role as UserRole | undefined;
  if (!role) return;
  const canRequest = ['OPERATOR','MASTER','QUALITY','ADMIN','PRODUCTION_MANAGER'].includes(role);
  const canInspect = ['QUALITY','ADMIN','PRODUCTION_MANAGER'].includes(role);
  const canConfigure = ['ADMIN','PRODUCTION_MANAGER','PLANNER','MASTER'].includes(role);

  const [{ data: taskData, error: taskError }, { data: inspectionData, error: inspectionError }] = await Promise.all([
    client.from('production_tasks').select('id,order_id,operation_sequence,status,planned_quantity,actual_quantity,quality_required,quality_status').order('planned_start', { ascending:true }),
    client.from('quality_inspections').select('task_id,inspected_at,status,good_quantity,scrap_quantity,defect_code,comment').order('inspected_at', { ascending:false })
  ]);
  if (taskError) throw taskError; if (inspectionError) throw inspectionError;
  const tasks=(Array.isArray(taskData)?taskData:[]) as TaskRow[];
  const inspections=(Array.isArray(inspectionData)?inspectionData:[]) as InspectionRow[];
  const latest=new Map<string,InspectionRow>();
  for(const item of inspections) if(!latest.has(item.task_id)) latest.set(item.task_id,item);
  const required=tasks.filter(t=>t.quality_required);
  const pending=required.filter(t=>t.quality_status==='PENDING').length;
  const approved=required.filter(t=>t.quality_status==='APPROVED').length;
  const rejected=required.filter(t=>t.quality_status==='REJECTED').length;
  const controlled=approved+rejected;
  const inspectedGood=inspections.reduce((sum,item)=>sum+Number(item.good_quantity||0),0);
  const inspectedScrap=inspections.reduce((sum,item)=>sum+Number(item.scrap_quantity||0),0);
  const inspectedTotal=inspectedGood+inspectedScrap;
  const rejectionRate=pct(rejected,controlled);
  const scrapRate=pct(inspectedScrap,inspectedTotal);

  const host=document.createElement('section'); host.className='panel quality-page';
  host.innerHTML=`<div class="panel-head"><div><h2>ОТК / контроль качества</h2><div class="subtle">${pending} заданий ожидают решения · APPROVED полного факта автоматически завершает задание и синхронизирует факт заказа · роль ${esc(role)}</div></div></div>
    <div class="quality-kpi-grid">
      <div class="kpi-card"><div class="subtle">Требуют ОТК</div><strong>${required.length}</strong></div>
      <div class="kpi-card"><div class="subtle">Ожидают решения</div><strong>${pending}</strong></div>
      <div class="kpi-card"><div class="subtle">Принято</div><strong>${approved}</strong><div class="subtle">${pct(approved,required.length)}</div></div>
      <div class="kpi-card"><div class="subtle">Отклонено</div><strong>${rejected}</strong><div class="subtle">${rejectionRate}</div></div>
      <div class="kpi-card"><div class="subtle">Годная по контролю</div><strong>${inspectedGood}</strong></div>
      <div class="kpi-card"><div class="subtle">Брак по контролю</div><strong>${inspectedScrap}</strong><div class="subtle">${scrapRate}</div></div>
    </div>
    <div class="execution-table-wrap"><table><thead><tr><th>Задание</th><th>Статус</th><th>Факт / план</th><th>Последний контроль</th><th>Действие</th></tr></thead><tbody>${tasks.map(task=>{
      const inspection=latest.get(task.id);
      let action='—';
      if(task.quality_required){
        if(task.quality_status==='PENDING'&&canInspect) action=`<button class="tiny" data-quality-review="${esc(task.id)}">Открыть проверку</button>`;
        else if(canRequest&&task.quality_status!=='PENDING'&&!['COMPLETED','CANCELLED'].includes(task.status)) action=`<button class="tiny" data-quality-request="${esc(task.id)}">Запросить ОТК</button>`;
      } else if(canConfigure&&!['COMPLETED','CANCELLED'].includes(task.status)) action=`<button class="tiny" data-quality-config="${esc(task.id)}">Включить ОТК</button>`;
      const toggle=task.quality_required&&canConfigure&&!['COMPLETED','CANCELLED'].includes(task.status) ? `<button class="tiny" data-quality-config="${esc(task.id)}">Отключить ОТК</button>` : '';
      const decision=inspection ? `${qualityLabel(inspection.status)}<div class="subtle">${new Date(inspection.inspected_at).toLocaleString('ru-RU')}${inspection.defect_code?` · дефект: ${esc(inspection.defect_code)}`:''}</div>` : '—';
      return `<tr><td><strong>${esc(task.id)}</strong><div class="subtle">Заказ ${esc(task.order_id)} · оп. ${task.operation_sequence}</div></td><td>${task.quality_required?qualityLabel(task.quality_status):'Не требуется'}${task.quality_required&&task.quality_status==='APPROVED'&&task.status==='COMPLETED'?'<div class="subtle">✓ Задание завершено после ОТК</div>':''}</td><td>${Number(task.actual_quantity)} / ${Number(task.planned_quantity)}</td><td>${decision}</td><td>${action} ${toggle}</td></tr>`;
    }).join('')||'<tr><td colspan="5">Производственных заданий нет</td></tr>'}</tbody></table></div>
    <form id="quality-page-form" class="result-form" hidden><h3>Решение ОТК</h3><div class="subtle" data-quality-form-hint>Для APPROVED сервер проверит соответствие полного факта задания.</div><input type="hidden" name="task"><select name="status"><option value="APPROVED">Принято</option><option value="REJECTED">Отклонено</option></select><input name="good" type="number" min="0" step="0.001" value="0" required placeholder="Годное по результату контроля"><input name="scrap" type="number" min="0" step="0.001" value="0" required placeholder="Брак по результату контроля"><input name="defect" placeholder="Код дефекта (обязательно при отклонении)"><input name="comment" placeholder="Комментарий ОТК"><button class="primary" type="submit">Зафиксировать решение</button></form>`;
  root.appendChild(host);
  const rpc=new SupabaseMesQualityRpc(client);
  host.querySelectorAll<HTMLButtonElement>('[data-quality-config]').forEach(button=>button.addEventListener('click',async()=>{const task=tasks.find(t=>t.id===button.dataset.qualityConfig);if(!task)return;try{await rpc.setQualityRequired(task.id,!task.quality_required);window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось изменить требование ОТК');}}));
  host.querySelectorAll<HTMLButtonElement>('[data-quality-request]').forEach(button=>button.addEventListener('click',async()=>{try{await rpc.requestQualityCheck(button.dataset.qualityRequest??'');window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось отправить запрос ОТК');}}));
  host.querySelectorAll<HTMLButtonElement>('[data-quality-review]').forEach(button=>button.addEventListener('click',()=>{const form=host.querySelector<HTMLFormElement>('#quality-page-form');if(!form)return;const task=tasks.find(item=>item.id===(button.dataset.qualityReview??''));if(!task)return;(form.elements.namedItem('task') as HTMLInputElement).value=task.id;(form.elements.namedItem('good') as HTMLInputElement).value=String(task.actual_quantity);(form.elements.namedItem('scrap') as HTMLInputElement).value='0';(form.elements.namedItem('defect') as HTMLInputElement).value='';(form.elements.namedItem('comment') as HTMLInputElement).value='';(form.querySelector('[data-quality-form-hint]') as HTMLElement).textContent=`Задание ${task.id}: факт ${task.actual_quantity} из ${task.planned_quantity}. При APPROVED полного факта сервер завершит задание автоматически.`;form.hidden=false;form.scrollIntoView({behavior:'smooth',block:'center'});}));
  host.querySelector<HTMLFormElement>('#quality-page-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const data=new FormData(form);const status=String(data.get('status')??'APPROVED') as 'APPROVED'|'REJECTED';const good=Number(data.get('good')??0);const scrap=Number(data.get('scrap')??0);const defect=String(data.get('defect')??'').trim();if(!Number.isFinite(good)||!Number.isFinite(scrap)||good<0||scrap<0||good+scrap<=0){window.alert('Укажите корректные количества результата контроля');return;}if(status==='REJECTED'&&!defect){window.alert('Для отклонения необходимо указать код дефекта');return;}try{await rpc.submitQualityInspection(String(data.get('task')??''),status,good,scrap,defect,String(data.get('comment')??''),new Date().toISOString());window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось сохранить решение ОТК');}});
}
