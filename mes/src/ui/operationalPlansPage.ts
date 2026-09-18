import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesOperationalPlanRpc } from '../integration/mesOperationalPlanRpc';
import './operationalPlansPage.css';

const ROLES=['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'];
type PlanRow={id:string;version:number;status:'DRAFT'|'RELEASED'|'ARCHIVED';horizon_start:string;horizon_end:string;created_at:string};
type OrderRow={id:string;plan_id:string;status:string};
const esc=(v:unknown)=>String(v??'').replace(/[&<>\\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[c]??c));
const dt=(v:string)=>new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
const dateInput=(d:Date)=>{const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);};
const statusLabel=(v:string)=>({DRAFT:'Черновик',RELEASED:'Выпущен',ARCHIVED:'Архив'} as Record<string,string>)[v]??v;
const statusClass=(v:string)=>v.toLowerCase();

export async function mountOperationalPlansPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client,{hydrateSnapshot:false});
  if(!auth.identity||!ROLES.includes(auth.identity.role)||root.querySelector('.operational-plans-page'))return;
  const rpc=new SupabaseMesOperationalPlanRpc(client);
  const host=document.createElement('section');host.className='panel operational-plans-page';root.appendChild(host);

  const render=async()=>{
    host.innerHTML='<div class="panel-head"><div><h2>Операционные планы</h2><div class="subtle">Горизонт 1–30 дней · DRAFT → RELEASED · выбранный план используется заявками и Gantt</div></div><button class="primary" data-plan-new>Новый план</button></div><div class="plan-toolbar" hidden data-plan-form-host></div><div class="plan-table-wrap"><div class="subtle" style="padding:24px 20px">Загрузка…</div></div>';
    const tableHost=host.querySelector<HTMLElement>('.plan-table-wrap')!;
    try{
      const [plansQ,ordersQ]=await Promise.all([
        client.from('operational_plans').select('id,version,status,horizon_start,horizon_end,created_at').order('created_at',{ascending:false}),
        client.from('production_orders').select('id,plan_id,status').limit(1000)
      ]);
      if(plansQ.error)throw plansQ.error;if(ordersQ.error)throw ordersQ.error;
      const plans=(plansQ.data??[]) as PlanRow[];const orders=(ordersQ.data??[]) as OrderRow[];
      const activeOrders=(planId:string)=>orders.filter(o=>o.plan_id===planId&&!['COMPLETED','CANCELLED'].includes(o.status)).length;
      if(!plans.length){
        tableHost.innerHTML='<div class="subtle" style="padding:28px 20px">Операционных планов пока нет. Создайте первый план.</div>';
      }else{
        tableHost.innerHTML='<table><thead><tr><th>План</th><th>Горизонт</th><th>Версия</th><th>Заказы</th><th>Создан</th><th>Действия</th></tr></thead><tbody>'+
          plans.map(p=>'<tr><td><strong>'+esc(p.id)+'</strong><div class="plan-meta"><span class="plan-status '+statusClass(p.status)+'">'+statusLabel(p.status)+'</span></div></td><td>'+dt(p.horizon_start)+'<div class="plan-meta">до '+dt(p.horizon_end)+'</div></td><td>v'+p.version+'</td><td>'+activeOrders(p.id)+'</td><td>'+dt(p.created_at)+'</td><td class="plan-actions">'+
            (p.status==='DRAFT'?'<button class="tiny" data-plan-release="'+esc(p.id)+'" data-plan-version="'+p.version+'">Выпустить</button>':'')+
            (p.status!=='ARCHIVED'?'<button class="tiny" data-plan-archive="'+esc(p.id)+'" data-plan-version="'+p.version+'">Архивировать</button>':'')+
            '</td></tr>').join('')+
          '</tbody></table>';
      }

      host.querySelector<HTMLButtonElement>('[data-plan-new]')?.addEventListener('click',()=>{
        const start=new Date();const end=new Date(start.getTime()+30*24*60*60*1000);
        const formHost=host.querySelector<HTMLElement>('[data-plan-form-host]')!;
        formHost.hidden=false;
        formHost.innerHTML='<form class="plan-form"><label>Начало горизонта<input name="start" type="datetime-local" value="'+dateInput(start)+'" required></label><label>Конец горизонта<input name="end" type="datetime-local" value="'+dateInput(end)+'" required></label><div style="display:flex;gap:6px"><button class="primary">Создать</button><button type="button" class="tiny" data-plan-cancel>Отмена</button></div></form>';
        formHost.querySelector<HTMLButtonElement>('[data-plan-cancel]')?.addEventListener('click',()=>{formHost.hidden=true;});
        formHost.querySelector('form')?.addEventListener('submit',async event=>{
          event.preventDefault();
          const form=event.currentTarget as HTMLFormElement;const f=new FormData(form);
          const start=String(f.get('start')??'');const end=String(f.get('end')??'');
          if(!start||!end||new Date(end)<=new Date(start)){window.alert('Проверьте горизонт плана');return;}
          const planId='PLAN-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomUUID().slice(0,8);
          try{await rpc.create(planId,new Date(start).toISOString(),new Date(end).toISOString());await render();}
          catch(error){window.alert(error instanceof Error?error.message:'Не удалось создать план');}
        });
      });

      host.querySelectorAll<HTMLButtonElement>('[data-plan-release],[data-plan-archive]').forEach(button=>button.addEventListener('click',async()=>{
        const planId=button.dataset.planRelease??button.dataset.planArchive??'';
        const next=button.dataset.planRelease?'RELEASED':'ARCHIVED';
        const version=Number(button.dataset.planVersion);
        button.disabled=true;
        try{await rpc.changeStatus(planId,next as 'RELEASED'|'ARCHIVED',version);await render();}
        catch(error){button.disabled=false;window.alert(error instanceof Error?error.message:'Не удалось изменить статус плана');}
      }));
    }catch(error){tableHost.innerHTML='<div class="plan-error">'+esc(error instanceof Error?error.message:'Не удалось загрузить планы')+'</div>';}
  };
  await render();
}
