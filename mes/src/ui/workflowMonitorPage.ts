import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';

interface TaskRow { id:string; order_id:string; status:string; planned_quantity:number; actual_quantity:number; quality_required:boolean; quality_status:string; version:number; }
interface OrderRow { id:string; number:string; status:string; quantity:number; completed_quantity:number; }
interface OutboxRow { id:string; idempotency_key:string; status:string; attempts:number; last_error:string|null; created_at:string; }
interface IntegrityResult { ok:boolean; checkedAt:string; violationCount:number; violations:Array<{entityId:string;entityType:string;code:string;message:string}> }

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;' }[ch] ?? ch)); }
function statusClass(value:string):string { if(['COMPLETED','APPROVED','SENT'].includes(value)) return 'status-ok'; if(['FAILED','BLOCKED','CANCELLED','REJECTED'].includes(value)) return 'status-danger'; if(['RUNNING','PAUSED','PARTIALLY_COMPLETED','PENDING','SENDING'].includes(value)) return 'status-warning'; return 'status-neutral'; }
function pill(value:string):string { return `<span class="status-pill ${statusClass(value)}">${esc(value)}</span>`; }

export async function mountWorkflowMonitorPage(root:HTMLElement, client:SupabaseClient):Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;
  const host=document.createElement('section'); host.className='panel workflow-monitor-page';
  host.innerHTML=`<div class="panel-head"><div><h2>Контроль производственного workflow</h2><div class="subtle">Серверное состояние заданий, заказов, ОТК и обмена с Workforce</div></div><button class="primary" data-refresh-workflow>Обновить</button></div><div class="workflow-monitor-body"><div data-monitor-kpis></div><div class="workflow-monitor-grid"><div class="workflow-monitor-card"><h3>Задания</h3><div data-monitor-tasks></div></div><div class="workflow-monitor-card"><h3>Outbox Workforce</h3><div data-monitor-outbox></div></div><div class="workflow-monitor-card"><h3>Диагностика целостности</h3><div data-monitor-integrity></div></div></div></div>`;
  root.appendChild(host);
  const k=host.querySelector<HTMLElement>('[data-monitor-kpis]')!, t=host.querySelector<HTMLElement>('[data-monitor-tasks]')!, o=host.querySelector<HTMLElement>('[data-monitor-outbox]')!, i=host.querySelector<HTMLElement>('[data-monitor-integrity]')!;
  const refresh=async()=>{
    [k,t,o,i].forEach(x=>x.innerHTML='<div class="subtle">Загрузка…</div>');
    try {
      const [ordersR,tasksR,outboxR,integrityR]=await Promise.all([
        client.from('production_orders').select('id,number,status,quantity,completed_quantity').limit(250),
        client.from('production_tasks').select('id,order_id,status,planned_quantity,actual_quantity,quality_required,quality_status,version').order('version',{ascending:false}).limit(250),
        client.from('integration_outbox').select('id,idempotency_key,status,attempts,last_error,created_at').order('created_at',{ascending:false}).limit(20),
        client.rpc('mes_check_operational_integrity')
      ]);
      for(const r of [ordersR,tasksR,outboxR,integrityR]) if(r.error) throw r.error;
      const orders=(ordersR.data??[]) as OrderRow[], tasks=(tasksR.data??[]) as TaskRow[], outbox=(outboxR.data??[]) as OutboxRow[], integrity=integrityR.data as unknown as IntegrityResult;
      const waitingQa=tasks.filter(x=>x.quality_required&&x.quality_status==='PENDING').length;
      const active=tasks.filter(x=>['RUNNING','PAUSED','PARTIALLY_COMPLETED'].includes(x.status)).length;
      const stuck=outbox.filter(x=>['PENDING','FAILED','SENDING'].includes(x.status)).length;
      k.innerHTML=[['Заказы',orders.length,''],['Активные задания',active,active?'warning':''],['Ожидают ОТК',waitingQa,waitingQa?'warning':''],['Outbox требует доставки',stuck,stuck?'warning':''],['Нарушения целостности',integrity.violationCount,integrity.ok?'':'danger']].map(([a,b,c])=>`<div class="workflow-monitor-kpi"><span>${a}</span><strong class="${c?'kpi-'+c:''}">${b}</strong></div>`).join('');
      t.innerHTML=tasks.length?`<div class="workflow-monitor-table"><table><thead><tr><th>Задание</th><th>Заказ</th><th>Статус</th><th>Факт</th><th>ОТК</th></tr></thead><tbody>${tasks.slice(0,20).map(x=>{const ord=orders.find(q=>q.id===x.order_id);return `<tr><td><strong>${esc(x.id)}</strong><div class="subtle">v${x.version}</div></td><td>${esc(ord?.number??x.order_id)}</td><td>${pill(x.status)}</td><td>${x.actual_quantity} / ${x.planned_quantity}</td><td>${x.quality_required?pill(x.quality_status):'<span class="subtle">—</span>'}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="subtle">Заданий нет.</div>';
      o.innerHTML=outbox.length?`<div class="workflow-monitor-table"><table><thead><tr><th>Idempotency</th><th>Статус</th><th>Попытки</th><th>Ошибка</th></tr></thead><tbody>${outbox.map(x=>`<tr><td>${esc(x.idempotency_key)}</td><td>${pill(x.status)}</td><td>${x.attempts}</td><td>${esc(x.last_error??'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="subtle">Outbox пуст.</div>';
      i.innerHTML=integrity.ok?`<div class="integrity-ok">✓ Нарушений не обнаружено<div class="subtle">Проверено: ${new Date(integrity.checkedAt).toLocaleString('ru-RU')}</div></div>`:`<div class="integrity-danger"><strong>Найдено нарушений: ${integrity.violationCount}</strong><table><thead><tr><th>Код</th><th>Объект</th><th>Описание</th></tr></thead><tbody>${integrity.violations.map(v=>`<tr><td>${esc(v.code)}</td><td>${esc(v.entityId)}</td><td>${esc(v.message)}</td></tr>`).join('')}</tbody></table></div>`;
    } catch(e) { const msg=esc(e instanceof Error?e.message:'Ошибка'); [k,t,o,i].forEach(x=>x.innerHTML=`<div class="detail-error">${msg}</div>`); }
  };
  host.querySelector<HTMLButtonElement>('[data-refresh-workflow]')?.addEventListener('click',()=>void refresh());
  await refresh();
}
