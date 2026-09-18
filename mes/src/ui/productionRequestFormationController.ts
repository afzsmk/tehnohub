import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseMesProductionRequestRpc } from '../integration/mesProductionRequestRpc';

const ROLES=['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'];
const css='.production-formation-dialog{position:fixed;inset:0;background:#0005;display:flex;justify-content:flex-end;z-index:80}.production-formation-card{width:min(720px,100vw);height:100%;background:var(--surface,#fff);box-shadow:-12px 0 32px #0002;padding:22px;overflow:auto}.production-formation-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:18px}.production-formation-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.production-formation-fields label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted,#667085)}.production-formation-items{border:1px solid var(--border,#e5e7eb);border-radius:10px;margin-top:16px}.production-formation-item{display:grid;grid-template-columns:52px 1fr auto;gap:10px;padding:11px 12px;border-bottom:1px solid var(--border,#e5e7eb)}.production-formation-item:last-child{border-bottom:0}.production-formation-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.production-formation-note{margin-top:12px;padding:10px 12px;border-radius:8px;background:var(--surface-muted,#f7f8fa);font-size:12px;color:var(--muted,#667085)}@media(max-width:720px){.production-formation-fields{grid-template-columns:1fr}.production-formation-item{grid-template-columns:42px 1fr}}';

function esc(value:unknown):string{return String(value??'').replace(/[&<>\\"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[ch]??ch));}
function localDateTime(date:string):string{
  const d=new Date(date+'T23:59:00');
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}
function goToPlans():void{
  const button=document.querySelector<HTMLButtonElement>('.mes-workspace-nav [data-target=".operational-plans-page"]');
  if(button)button.click();
}
function installCss():void{
  if(document.getElementById('production-formation-style'))return;
  const style=document.createElement('style');style.id='production-formation-style';style.textContent=css;document.head.appendChild(style);
}

export async function mountProductionRequestFormation(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const session=await client.auth.getSession();
  if(!session.data.session)return;
  const role=(session.data.session.user.app_metadata?.mes_role??'') as string;
  if(!ROLES.includes(role)||root.dataset.productionFormationBound==='1')return;
  root.dataset.productionFormationBound='1';
  installCss();
  const rpc=new SupabaseMesProductionRequestRpc(client);

  const open=async(requestId:string):Promise<void>=>{
    const [requestQ,itemsQ,productsQ,plansQ]=await Promise.all([
      client.from('production_requests').select('id,request_number,object_name,desired_date,status').eq('id',requestId).single(),
      client.from('production_request_items').select('id,line_no,product_id,quantity').eq('request_id',requestId).order('line_no'),
      client.from('products').select('id,code,name,unit').order('code'),
      client.from('operational_plans').select('id,version,status,horizon_start,horizon_end').neq('status','ARCHIVED').order('created_at',{ascending:false})
    ]);
    for(const q of [requestQ,itemsQ,productsQ,plansQ])if(q.error)throw q.error;
    const request=requestQ.data as {id:string;request_number:string;object_name:string;desired_date:string;status:string};
    const items=(itemsQ.data??[]) as Array<{id:string;line_no:number;product_id:string;quantity:number}>;
    const products=(productsQ.data??[]) as Array<{id:string;code:string;name:string;unit:string}>;
    const plans=(plansQ.data??[]) as Array<{id:string;version:number;status:string;horizon_start:string;horizon_end:string}>;
    if(request.status==='CANCELLED')return;
    const productMap=new Map(products.map(p=>[p.id,p]));
    if(!plans.length){
      window.alert('Нет операционного плана. Сначала создайте план в разделе «Планы».');
      goToPlans();
      return;
    }
    const preferred=plans.find(p=>p.status==='RELEASED')??plans[0];
    const dialog=document.createElement('div');dialog.className='production-formation-dialog';
    dialog.innerHTML='<div class="production-formation-card"><div class="production-formation-head"><div><div class="subtle">Заявка</div><h2 style="margin:4px 0">'+esc(request.request_number)+'</h2><div class="subtle">'+esc(request.object_name)+'</div></div><button class="tiny" data-close>Закрыть</button></div>'+
      '<form><div class="production-formation-fields"><label>Операционный план<select name="plan" required>'+
        plans.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===preferred.id?'selected':'')+'>'+esc(p.id)+' · v'+p.version+' · '+esc(p.status==='RELEASED'?'Выпущен':'Черновик')+'</option>').join('')+
      '</select></label><label>Срок всех заказов<input name="due" type="datetime-local" value="'+localDateTime(request.desired_date)+'" required></label><label>Приоритет<select name="priority"><option value="LOW">Низкий</option><option value="NORMAL" selected>Обычный</option><option value="HIGH">Высокий</option><option value="URGENT">Срочный</option></select></label></div>'+
      '<div class="production-formation-items"><div class="production-formation-item" style="font-size:11px;color:var(--muted,#667085);font-weight:600"><span>№</span><span>Номенклатура</span><span>Количество</span></div>'+
      items.map(item=>{const p=productMap.get(item.product_id);return '<div class="production-formation-item"><strong>'+item.line_no+'</strong><div><b>'+esc(p?.code??item.product_id)+'</b><div class="subtle">'+esc(p?.name??'Номенклатура')+'</div></div><span>'+item.quantity+' '+esc(p?.unit??'')+'</span></div>';}).join('')+
      '</div><div class="production-formation-note">Сначала MES выполнит предварительную проверку маршрута и срока. Если хотя бы одна позиция не помещается, сначала исправьте срок/план или разбейте заказ на части.</div><div data-feasibility style="margin-top:14px"><div class="subtle">Проверка выполнимости…</div></div><div class="production-formation-actions"><button type="button" class="tiny" data-close>Отмена</button><button class="primary" type="submit" data-submit-formation disabled>Создать заказы и задания</button></div></form></div>';
    document.body.appendChild(dialog);
    const close=()=>dialog.remove();
    dialog.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.addEventListener('click',close));
    dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
    const formElement=dialog.querySelector<HTMLFormElement>('form');
    const feasibilityHost=dialog.querySelector<HTMLElement>('[data-feasibility]');
    const submitButton=dialog.querySelector<HTMLButtonElement>('[data-submit-formation]');
    const runFeasibility=async():Promise<boolean>=>{
      const data=formElement?new FormData(formElement):null;
      const selectedPlan=String(data?.get('plan')??'');
      const dueLocal=String(data?.get('due')??'');
      if(!selectedPlan||!dueLocal)return false;
      if(feasibilityHost)feasibilityHost.innerHTML='<div class="subtle">Проверяем маршрут и срок…</div>';
      if(submitButton)submitButton.disabled=true;
      try{
        const result=await rpc.checkFeasibility({requestId,planId:selectedPlan,dueAt:new Date(dueLocal).toISOString()});
        const feasible=result.feasible===true;
        const rows=Array.isArray(result.items)?result.items as Array<Record<string,unknown>>:[];
        if(feasibilityHost)feasibilityHost.innerHTML='<div class="'+(feasible?'production-formation-feasible':'production-formation-blocked')+'"><strong>'+(feasible?'✓ Предварительно выполнимо':'⚠ Требует корректировки')+'</strong><div class="subtle" style="margin-top:6px">'+rows.map(row=>{
          const ok=row.feasible===true;
          return '<div style="margin-top:6px"><b>Позиция '+esc(row.lineNo)+'</b>: '+(ok?'OK':'Не помещается')+' · требуется '+esc(row.requiredHours)+' ч, доступно '+esc(row.availableHours)+' ч'+(row.reason?' · '+esc(row.reason):'');
        }).join('')+'</div>'+(result.note?'<div class="subtle" style="margin-top:8px">'+esc(result.note)+'</div>':'')+'</div>';
        if(submitButton)submitButton.disabled=!feasible;
        return feasible;
      }catch(error){
        if(feasibilityHost)feasibilityHost.innerHTML='<div class="detail-error">'+esc(error instanceof Error?error.message:'Не удалось проверить выполнимость')+'</div>';
        if(submitButton)submitButton.disabled=true;
        return false;
      }
    };
    formElement?.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[name="plan"],[name="due"]').forEach(field=>field.addEventListener('change',()=>void runFeasibility()));
    void runFeasibility();
    formElement?.addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget as HTMLFormElement;const data=new FormData(form);
      const planId=String(data.get('plan')??'');const dueLocal=String(data.get('due')??'');
      const priority=String(data.get('priority')??'NORMAL') as 'LOW'|'NORMAL'|'HIGH'|'URGENT';
      const submit=form.querySelector<HTMLButtonElement>('button[type="submit"]');if(submit)submit.disabled=true;
      try{
        const result=await rpc.createOrdersFromRequest({requestId,planId,priority,dueAt:new Date(dueLocal).toISOString()});
        close();
        document.querySelector<HTMLButtonElement>('[data-request-refresh]')?.click();
        const created=Number(result.createdOrders??0),planned=Number(result.plannedOrders??0),blocked=Number(result.blockedOrders??0);
        window.alert('Готово: создано заказов — '+created+', спланировано — '+planned+', заблокировано — '+blocked+'.');
      }catch(error){
        if(submit)submit.disabled=false;
        window.alert(error instanceof Error?error.message:'Не удалось сформировать производство');
      }
    });
  };

  const observer=new MutationObserver(()=>{
    const page=root.querySelector<HTMLElement>('.production-requests-page');
    if(!page)return;
    if(page.dataset.formationController==='1')return;
    page.dataset.formationController='1';
    page.addEventListener('click',event=>{
      const target=event.target as HTMLElement;
      const button=target.closest<HTMLButtonElement>('[data-form-request]');
      if(!button)return;
      const requestId=button.dataset.formRequest??'';
      if(requestId)void open(requestId).catch(error=>window.alert(error instanceof Error?error.message:'Не удалось открыть формирование производства'));
    });
  });
  observer.observe(root,{childList:true,subtree:true});
  const page=root.querySelector<HTMLElement>('.production-requests-page');
  if(page){
    page.dataset.formationController='1';
    page.addEventListener('click',event=>{
      const target=event.target as HTMLElement;const button=target.closest<HTMLButtonElement>('[data-form-request]');
      if(button?.dataset.formRequest)void open(button.dataset.formRequest).catch(error=>window.alert(error instanceof Error?error.message:'Не удалось открыть формирование производства'));
    });
  }
}
