import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaintenanceOrder } from '../types';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesMaintenanceRpc } from '../integration/mesMaintenanceRpc';

const ROLES = ['ADMIN','PRODUCTION_MANAGER','MASTER','DISPATCHER','MAINTENANCE','OPERATOR'];
interface EquipmentRow { id:string; code:string; name:string; work_center:string; active:boolean; }
interface DowntimeRow { id:string; equipment_id:string; reason_code:string; started_at:string; ended_at:string|null; comment:string|null; }
interface MaintenanceRow { id:string; equipment_id:string; type:MaintenanceOrder['type']; planned_start:string; planned_end:string; status:MaintenanceOrder['status']; comment:string|null; }
function esc(v:unknown):string { return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]??c)); }
function statusClass(v:string):string { if(['DONE'].includes(v))return 'status-ok'; if(['CANCELLED'].includes(v))return 'status-danger'; if(['IN_PROGRESS'].includes(v))return 'status-warning'; return 'status-neutral'; }
function dt(v:string):string { return new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}); }

export async function mountEquipmentOperationsPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client); const role=auth.identity?.role; if(!role||!ROLES.includes(role))return;
  const host=document.createElement('section'); host.className='panel equipment-operations-page';
  host.innerHTML=`<div class="panel-head"><div><h2>Оборудование и простои</h2><div class="subtle">Оперативное состояние оборудования, простои и ППР · роль ${esc(role)}</div></div><button class="primary" data-eq-refresh>Обновить</button></div><div class="equipment-operations-grid"><div class="equipment-op-card"><h3>Активные простои</h3><div data-eq-downtime></div></div><div class="equipment-op-card"><h3>ППР и ремонт</h3><div data-eq-maintenance></div></div></div>`;
  root.appendChild(host);
  const downtimeHost=host.querySelector<HTMLElement>('[data-eq-downtime]')!, maintHost=host.querySelector<HTMLElement>('[data-eq-maintenance]')!;
  const rpc=new SupabaseMesMaintenanceRpc(client);

  const refresh=async()=>{
    downtimeHost.innerHTML=maintHost.innerHTML='<div class="subtle">Загрузка…</div>';
    try{
      const [eqR,dtR,moR]=await Promise.all([
        client.from('equipment').select('id,code,name,work_center,active').eq('active',true).order('name'),
        client.from('downtime_events').select('id,equipment_id,reason_code,started_at,ended_at,comment').order('started_at',{ascending:false}).limit(30),
        client.from('maintenance_orders').select('id,equipment_id,type,planned_start,planned_end,status,comment').order('planned_start',{ascending:false}).limit(30)
      ]);
      for(const r of [eqR,dtR,moR])if(r.error)throw r.error;
      const eq=(eqR.data??[]) as EquipmentRow[], dts=(dtR.data??[]) as DowntimeRow[], mos=(moR.data??[]) as MaintenanceRow[];
      const active=dts.filter(x=>!x.ended_at);
      downtimeHost.innerHTML=`<form class="equipment-op-form" data-start-downtime><select name="equipment" required><option value="">Оборудование</option>${eq.map(e=>`<option value="${esc(e.id)}">${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select><input name="reason" required placeholder="Причина простоя"><input name="comment" placeholder="Комментарий"><button class="primary" type="submit">Начать простой</button></form>${dts.length?`<div class="table-wrap"><table><thead><tr><th>Оборудование</th><th>Причина</th><th>Начало</th><th>Окончание</th><th>Действие</th></tr></thead><tbody>${dts.map(x=>{const e=eq.find(q=>q.id===x.equipment_id);return `<tr><td>${esc(e?.name??x.equipment_id)}</td><td>${esc(x.reason_code)}</td><td>${dt(x.started_at)}</td><td>${x.ended_at?dt(x.ended_at):'<span class="status-pill status-warning">Открыт</span>'}</td><td>${!x.ended_at?`<button class="tiny" data-end-downtime="${esc(x.id)}">Завершить</button>`:'—'}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="subtle">Простоев нет.</div>'}`;
      maintHost.innerHTML=`<form class="equipment-op-form" data-create-maint><select name="equipment" required><option value="">Оборудование</option>${eq.map(e=>`<option value="${esc(e.id)}">${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select><select name="type"><option value="PM">ППР</option><option value="REPAIR">Ремонт</option><option value="INSPECTION">Осмотр</option></select><input name="start" type="datetime-local" required><input name="end" type="datetime-local" required><input name="comment" placeholder="Комментарий"><button class="primary" type="submit">Создать ППР</button></form>${mos.length?`<div class="table-wrap"><table><thead><tr><th>Оборудование</th><th>Тип</th><th>Интервал</th><th>Статус</th><th>Действие</th></tr></thead><tbody>${mos.map(x=>{const e=eq.find(q=>q.id===x.equipment_id);const action=x.status==='PLANNED'?`<button class="tiny" data-maint="START" data-maint-id="${esc(x.id)}">Начать</button><button class="tiny danger-button" data-maint="CANCEL" data-maint-id="${esc(x.id)}">Отменить</button>`:x.status==='IN_PROGRESS'?`<button class="tiny action-complete" data-maint="COMPLETE" data-maint-id="${esc(x.id)}">Завершить</button><button class="tiny danger-button" data-maint="CANCEL" data-maint-id="${esc(x.id)}">Отменить</button>`:'—';return `<tr><td>${esc(e?.name??x.equipment_id)}</td><td>${esc(x.type)}</td><td>${dt(x.planned_start)} → ${dt(x.planned_end)}</td><td><span class="status-pill ${statusClass(x.status)}">${esc(x.status)}</span></td><td>${action}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="subtle">Заявок обслуживания нет.</div>'}`;
      if(active.length===0) downtimeHost.querySelector('[data-start-downtime]')?.classList.add('no-open-downtime');

      host.querySelector<HTMLFormElement>('[data-start-downtime]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const d=new FormData(f);try{await rpc.startDowntime(String(d.get('equipment')??''),String(d.get('reason')??''),String(d.get('comment')??'')||undefined);await refresh();}catch(err){window.alert(err instanceof Error?err.message:'Не удалось зарегистрировать простой');}});
      host.querySelectorAll<HTMLButtonElement>('[data-end-downtime]').forEach(b=>b.addEventListener('click',async()=>{try{await rpc.endDowntime(b.dataset.endDowntime??'');await refresh();}catch(err){window.alert(err instanceof Error?err.message:'Не удалось завершить простой');}}));
      host.querySelector<HTMLFormElement>('[data-create-maint]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const d=new FormData(f);const start=String(d.get('start')??''),end=String(d.get('end')??'');if(new Date(start).getTime()>=new Date(end).getTime()){window.alert('Окончание должно быть позже начала');return;}try{await rpc.createOrder(String(d.get('equipment')??''),String(d.get('type')??'PM') as MaintenanceOrder['type'],new Date(start).toISOString(),new Date(end).toISOString(),String(d.get('comment')??'')||undefined);await refresh();}catch(err){window.alert(err instanceof Error?err.message:'Не удалось создать ППР');}});
      host.querySelectorAll<HTMLButtonElement>('[data-maint]').forEach(b=>b.addEventListener('click',async()=>{try{await rpc.changeStatus(b.dataset.maintId??'',b.dataset.maint as 'START'|'COMPLETE'|'CANCEL');await refresh();}catch(err){window.alert(err instanceof Error?err.message:'Не удалось изменить обслуживание');}}));
    }catch(err){const msg=esc(err instanceof Error?err.message:'Ошибка загрузки оборудования');downtimeHost.innerHTML=maintHost.innerHTML=`<div class="detail-error">${msg}</div>`;}
  };
  host.querySelector<HTMLButtonElement>('[data-eq-refresh]')?.addEventListener('click',()=>void refresh());
  await refresh();
}
