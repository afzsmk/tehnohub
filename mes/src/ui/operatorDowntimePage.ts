import './operatorDowntimePage.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesExecutionRpc } from '../integration/mesExecutionRpc';

type Assignment = { task_id: string; employee_id: string | null; equipment_id: string | null };
type Equipment = { id: string; name: string; active: boolean };
type Downtime = { id: string; equipment_id: string; reason_code: string; started_at: string; ended_at: string | null };
const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]??c));
const dt=(v:string)=>new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
export async function mountOperatorDowntimePage(root:HTMLElement,client:SupabaseClient):Promise<void>{
 const auth=await getMesAuthState(client);if(!auth.identity)return;
 const section=document.createElement('section');section.className='panel operator-downtime-page';
 section.innerHTML='<div class="panel-head"><div><h2>Простой на рабочем месте</h2><div class="subtle">Быстрая регистрация и закрытие простоя без перехода в раздел оборудования</div></div><button class="primary" data-operator-downtime-refresh>Обновить</button></div><div data-operator-downtime-body><div class="subtle">Загрузка…</div></div>';
 root.appendChild(section);
 const body=section.querySelector<HTMLElement>('[data-operator-downtime-body]')!;const rpc=new SupabaseMesExecutionRpc(client);
 const refresh=async()=>{try{
  const [tasksQ,assignQ,equipQ,downQ]=await Promise.all([
   client.from('production_tasks').select('id,status').in('status',['READY','RUNNING','PAUSED','PARTIALLY_COMPLETED']).limit(200),
   client.from('task_assignments').select('task_id,employee_id,equipment_id').limit(1000),
   client.from('equipment').select('id,name,active').eq('active',true).order('name'),
   client.from('downtime_events').select('id,equipment_id,reason_code,started_at,ended_at').is('ended_at',null).order('started_at',{ascending:false}).limit(50)
  ]);
  for(const q of [tasksQ,assignQ,equipQ,downQ])if(q.error)throw q.error;
  const tasks=(tasksQ.data??[]) as {id:string;status:string}[],assignments=(assignQ.data??[]) as Assignment[],equipment=(equipQ.data??[]) as Equipment[],downtimes=(downQ.data??[]) as Downtime[];
  const allowedTaskIds=auth.identity!.role==='OPERATOR'?new Set(assignments.filter(a=>a.employee_id===auth.identity!.employeeId).map(a=>a.task_id)):new Set(tasks.map(t=>t.id));
  const visibleEquipmentIds=auth.identity!.role==='OPERATOR'?new Set(assignments.filter(a=>allowedTaskIds.has(a.task_id)&&a.equipment_id).map(a=>a.equipment_id as string)):new Set(equipment.map(e=>e.id));
  const visibleEquipment=equipment.filter(e=>visibleEquipmentIds.has(e.id));
  const active=downtimes.filter(d=>visibleEquipmentIds.has(d.equipment_id));
  body.innerHTML=`<div class="operator-downtime-summary"><strong>${active.length}</strong> открытых простоя</div>${active.length?`<div class="operator-downtime-list">${active.map(d=>`<div class="operator-downtime-row"><div><strong>${esc(equipment.find(e=>e.id===d.equipment_id)?.name??d.equipment_id)}</strong><div class="subtle">${esc(d.reason_code)} · ${dt(d.started_at)}</div></div><button class="tiny" data-end-operator-downtime="${esc(d.id)}">Закрыть простой</button></div>`).join('')}</div>`:'<div class="subtle" style="padding:12px 18px">Открытых простоев нет.</div>'}<form class="operator-downtime-form" data-start-operator-downtime><select name="equipment" required><option value="">Оборудование</option>${visibleEquipment.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select><select name="reason"><option value="BREAKDOWN">Авария</option><option value="SETUP">Наладка</option><option value="MATERIAL">Нет материала</option><option value="QUALITY">Проблема качества</option><option value="OTHER">Другое</option></select><input name="comment" maxlength="500" placeholder="Комментарий"><button class="primary" type="submit">Начать простой</button></form>`;
  body.querySelector<HTMLFormElement>('[data-start-operator-downtime]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const d=new FormData(f);const submit=f.querySelector<HTMLButtonElement>('button[type=submit]');if(submit)submit.disabled=true;try{await rpc.startDowntime(String(d.get('equipment')??''),String(d.get('reason')??'OTHER'),String(d.get('comment')??'')||undefined);await refresh();}catch(err){window.alert(err instanceof Error?err.message:'Не удалось зарегистрировать простой');if(submit)submit.disabled=false;}});
  body.querySelectorAll<HTMLButtonElement>('[data-end-operator-downtime]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await rpc.endDowntime(b.dataset.endOperatorDowntime??'',new Date().toISOString());await refresh();}catch(err){window.alert(err instanceof Error?err.message:'Не удалось закрыть простой');b.disabled=false;}}));
 }catch(err){body.innerHTML=`<div class="detail-error">${esc(err instanceof Error?err.message:'Ошибка загрузки простоев')}</div>`;}};
 section.querySelector<HTMLButtonElement>('[data-operator-downtime-refresh]')?.addEventListener('click',()=>void refresh());await refresh();
}
