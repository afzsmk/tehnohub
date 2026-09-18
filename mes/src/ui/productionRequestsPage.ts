import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesProductionRequestRpc } from '../integration/mesProductionRequestRpc';
import { SupabaseMesOrderRpc } from '../integration/mesOrderRpc';
import { subscribeMesRealtime } from '../integration/mesRealtime';
import './ordersPage.css';

const ROLES=['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'];
type Product={id:string;code:string;name:string;unit:string};
type RequestRow={id:string;request_number:string;object_name:string;desired_date:string;status:'NEW'|'PLANNED'|'CANCELLED'};
type ItemRow={id:string;request_id:string;line_no:number;product_id:string;quantity:number};
type OrderRow={id:string;number:string;source_request_item_id:string|null;status:string;plan_id:string;due_at:string;quantity:number};
type PlanRow={id:string;version:number;status:'DRAFT'|'RELEASED'|'ARCHIVED';horizon_start:string;horizon_end:string};

const esc=(v:unknown)=>String(v??'').replace(/[&<>\\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[c]??c));
const statusClass=(v:string)=>v==='COMPLETED'||v==='PLANNED'?'status-ok':v==='CANCELLED'||v==='BLOCKED'?'status-danger':v==='RELEASED'||v==='IN_EXECUTION'?'status-warning':'status-neutral';
const statusLabel=(v:string)=>({NEW:'Новая',PLANNED:'Заказы созданы',CANCELLED:'Отменена',IMPORTED:'Импортирован',RELEASED:'Выпущен',IN_EXECUTION:'В работе',PARTIALLY_COMPLETED:'Частично',COMPLETED:'Завершён',BLOCKED:'Заблокирован'} as Record<string,string>)[v]??v;
const dtDate=(v:string)=>new Date(`${v}T00:00:00`).toLocaleDateString('ru-RU');
const dt=(v:string)=>new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
const id=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;

export async function mountProductionRequestsPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
 const auth=await getMesAuthState(client,{hydrateSnapshot:false});
 if(!auth.identity || !ROLES.includes(auth.identity.role) || root.querySelector('.production-requests-page')) return;
 const rpc=new SupabaseMesProductionRequestRpc(client);const orderRpc=new SupabaseMesOrderRpc(client);const db=client as SupabaseClient<any>;
 const host=document.createElement('section');host.className='panel production-requests-page';
 host.innerHTML=`<div class="panel-head"><div><h2>Заявки на изготовление</h2><div class="subtle">Входной документ производства → производственный заказ → планирование</div></div><div style="display:flex;gap:8px"><button class="tiny" data-request-refresh>Обновить</button><button class="primary" data-new-request>Новая заявка</button></div></div><div class="orders-toolbar"><span data-request-summary>Загрузка…</span></div><div data-request-form hidden></div><div data-request-convert hidden></div><div data-request-list><div class="subtle">Загрузка…</div></div>`;
 root.appendChild(host);
 const listHost=host.querySelector<HTMLElement>('[data-request-list]')!;const formHost=host.querySelector<HTMLElement>('[data-request-form]')!;const convertHost=host.querySelector<HTMLElement>('[data-request-convert]')!;const summaryHost=host.querySelector<HTMLElement>('[data-request-summary]')!;
 let products:Product[]=[];let requests:RequestRow[]=[];let items:ItemRow[]=[];let orders:OrderRow[]=[];let plans:PlanRow[]=[];let detailsOpen=new Set<string>();
 const load=async()=>{const [rq,iq,pq,oq,plq]=await Promise.all([
   db.from('production_requests').select('id,request_number,object_name,desired_date,status').order('desired_date',{ascending:true}).order('request_number',{ascending:true}),
   db.from('production_request_items').select('id,request_id,line_no,product_id,quantity').order('line_no',{ascending:true}),
   db.from('products').select('id,code,name,unit').order('code',{ascending:true}),
   db.from('production_orders').select('id,number,source_request_item_id,status,plan_id,due_at,quantity').order('due_at',{ascending:true}),
   db.from('operational_plans').select('id,version,status,horizon_start,horizon_end').neq('status','ARCHIVED').order('created_at',{ascending:false})
  ]);for(const q of [rq,iq,pq,oq,plq])if(q.error)throw q.error;requests=(rq.data??[]) as RequestRow[];items=(iq.data??[]) as ItemRow[];products=(pq.data??[]) as Product[];orders=(oq.data??[]) as OrderRow[];plans=(plq.data??[]) as PlanRow[];};
 const productMap=()=>new Map(products.map(p=>[p.id,p]));
 const orderByItem=()=>new Map(orders.filter(o=>o.source_request_item_id&&o.status!=='CANCELLED').map(o=>[o.source_request_item_id as string,o]));
 const renderList=()=>{
   const pm=productMap();
   const byItem=new Map<string,OrderRow[]>();
   for(const order of orders){
     if(!order.source_request_item_id||order.status==='CANCELLED')continue;
     const list=byItem.get(order.source_request_item_id)??[];
     list.push(order);byItem.set(order.source_request_item_id,list);
   }
   const allocation=(itemId:string)=>Number((byItem.get(itemId)??[]).reduce((sum,o)=>sum+Number(o.quantity||0),0).toFixed(3));
   summaryHost.textContent=`Заявок: ${requests.length} · новых: ${requests.filter(r=>r.status==='NEW').length} · в производственном контуре: ${orders.filter(o=>o.source_request_item_id&&o.status!=='CANCELLED').length}`;
   if(!requests.length){listHost.innerHTML='<div class="subtle" style="padding:16px 0">Заявок пока нет.</div>';return;}
   listHost.innerHTML=requests.map(request=>{
     const requestItems=items.filter(i=>i.request_id===request.id);
     const totalRequested=requestItems.reduce((sum,i)=>sum+Number(i.quantity),0);
     const totalAllocated=requestItems.reduce((sum,i)=>sum+allocation(i.id),0);
     const hasActiveOrders=requestItems.some(i=>(byItem.get(i.id)??[]).length>0);
     const editable=!hasActiveOrders&&request.status!=='CANCELLED';
     const canForm=requestItems.some(i=>allocation(i.id)<Number(i.quantity)-0.000001)&&request.status!=='CANCELLED';
     const detailHidden=!detailsOpen.has(request.id);
     const actions=[
       '<button class="tiny" data-request-details="'+esc(request.id)+'">'+(detailHidden?'Детали':'Скрыть')+'</button>',
       editable?'<button class="tiny" data-request-edit="'+esc(request.id)+'">Изменить</button>':'',
       editable?'<button class="tiny danger-button" data-request-cancel="'+esc(request.id)+'">Отменить</button>':'',
       canForm?'<button class="tiny primary" data-form-request="'+esc(request.id)+'">В производство</button>':''
     ].filter(Boolean).join(' ');
     const itemRows=requestItems.map(item=>{
       const p=pm.get(item.product_id);const itemOrders=byItem.get(item.id)??[];const allocated=allocation(item.id);
       const orderText=itemOrders.length?itemOrders.map(o=>'<div><strong>'+esc(o.number)+'</strong> · '+statusLabel(o.status)+' · '+o.quantity+' шт. · до '+dt(o.due_at)+'</div>').join(''):'<span class="subtle">Не создан</span>';
       const remaining=Math.max(0,Number(item.quantity)-allocated);
       const action=itemOrders.length
         ?'<span class="subtle">Детали заказа доступны в разделе «Заказы»</span>'
         :request.status==='CANCELLED'?'<span class="subtle">Недоступно</span>':'<button class="tiny" data-convert-item="'+esc(item.id)+'" data-request-id="'+esc(request.id)+'">Создать заказ</button>';
       return '<tr><td>'+item.line_no+'</td><td><strong>'+esc(p?.code??item.product_id)+'</strong><div class="subtle">'+esc(p?.name??'')+'</div></td><td>'+item.quantity+' '+esc(p?.unit??'')+'<div class="subtle">Осталось: '+remaining+' '+esc(p?.unit??'')+'</div></td><td>'+orderText+'</td><td>'+action+'</td></tr>';
     }).join('')||'<tr><td colspan="5">Позиции отсутствуют.</td></tr>';
     const detail='<tr class="request-detail-row" data-request-detail-row="'+esc(request.id)+'" '+(detailHidden?'hidden':'')+'><td colspan="5"><div class="order-detail"><div class="order-detail-head"><div><strong>Карточка '+esc(request.request_number)+'</strong><div class="subtle">Объект: '+esc(request.object_name)+' · желаемая дата: '+dtDate(request.desired_date)+'</div></div><span class="status-pill '+statusClass(request.status)+'">'+statusLabel(request.status)+'</span></div><div class="subtle" style="margin-bottom:10px">Запрошено: '+totalRequested+' ед. · распределено в заказы: '+totalAllocated+' ед.</div><div class="form-actions"><button type="button" class="tiny" data-request-feasibility="'+esc(request.id)+'">Проверить выполнимость</button><div data-request-feasibility-result="'+esc(request.id)+'" class="subtle"></div></div></div></td></tr>';
     return '<article class="order-detail" data-request-row="'+esc(request.id)+'" style="margin-bottom:14px"><div class="order-detail-head"><div><strong>'+esc(request.request_number)+'</strong><div class="subtle">'+esc(request.object_name)+' · желаемая дата '+dtDate(request.desired_date)+' · распределено '+totalAllocated+'/'+totalRequested+'</div></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end"><span class="status-pill '+statusClass(request.status)+'">'+statusLabel(request.status)+'</span>'+actions+'</div></div><div class="table-wrap"><table><thead><tr><th>№</th><th>Номенклатура</th><th>Количество</th><th>Производственные заказы</th><th>Действие</th></tr></thead><tbody>'+itemRows+'</tbody></table></div></article>'+detail;
   }).join('');
 };
 const renderNewForm=()=>{const productOptions=products.map(p=>`<option value="${esc(p.id)}">${esc(p.code)} — ${esc(p.name)} (${esc(p.unit)})</option>`).join('');formHost.hidden=false;formHost.innerHTML=`<form class="panel" style="margin:0 0 16px"><div class="panel-head"><div><h3 style="margin:0">Новая заявка</h3><div class="subtle">Сначала создаётся входной документ. Заказы создаются отдельно из его позиций.</div></div><button type="button" class="tiny" data-cancel-request>Отмена</button></div><div class="form-grid"><label>Номер заявки<input name="request_number" required maxlength="100" placeholder="ЗН-2026-001"></label><label>Наименование объекта<input name="object_name" required maxlength="200" placeholder="Объект / заказчик"></label><label>Желаемая дата<input name="desired_date" type="date" required></label></div><div style="margin-top:16px"><div class="detail-title">Позиции</div><div data-request-items></div><button type="button" class="secondary" data-add-request-item>+ Добавить позицию</button></div><div class="form-actions" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="primary" type="submit">Создать заявку</button></div></form>`;const form=formHost.querySelector('form')!;const linesHost=form.querySelector<HTMLElement>('[data-request-items]')!;const addLine=()=>{const line=document.createElement('div');line.className='task-resource-editor';line.style.margin='8px 0';line.innerHTML=`<select name="product_id" required><option value="">Номенклатура</option>${productOptions}</select><input name="quantity" type="number" min="0.001" step="0.001" placeholder="Количество" required><button type="button" class="tiny" data-remove>Удалить</button>`;line.querySelector('[data-remove]')?.addEventListener('click',()=>line.remove());linesHost.appendChild(line);};addLine();form.querySelector('[data-add-request-item]')?.addEventListener('click',addLine);form.querySelector('[data-cancel-request]')?.addEventListener('click',()=>{formHost.hidden=true;});form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);const rows=[...linesHost.querySelectorAll<HTMLElement>('.task-resource-editor')].map(line=>({productId:String((line.querySelector('[name="product_id"]') as HTMLSelectElement).value),quantity:Number((line.querySelector('[name="quantity"]') as HTMLInputElement).value)})).filter(x=>x.productId&&x.quantity>0);if(!rows.length){window.alert('Добавьте хотя бы одну позицию');return;}try{await rpc.create({id:id('REQ'),requestNumber:String(fd.get('request_number')??'').trim(),objectName:String(fd.get('object_name')??'').trim(),desiredDate:String(fd.get('desired_date')??''),items:rows});formHost.hidden=true;try{await load();renderList();}catch(refreshError){console.error('MES production request refresh failed after successful create',refreshError);listHost.innerHTML=`<div class="detail-error">Заявка создана, но список не удалось обновить: ${esc(refreshError instanceof Error?refreshError.message:'ошибка обновления')}</div>`;}}catch(err){window.alert(err instanceof Error?err.message:'Не удалось создать заявку');}});};
 const renderEditForm=async(requestId:string)=>{
   const request=requests.find(r=>r.id===requestId);if(!request)return;
   if(orders.some(o=>o.source_request_item_id&&items.find(i=>i.id===o.source_request_item_id)?.request_id===requestId&&o.status!=='CANCELLED')){
     window.alert('Заявка уже передана в производство и не может редактироваться.');return;
   }
   const requestItems=items.filter(i=>i.request_id===requestId);const productOptions=products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.code)+' — '+esc(p.name)+' ('+esc(p.unit)+')</option>').join('');
   formHost.hidden=false;
   formHost.innerHTML='<form class="panel" style="margin:0 0 16px"><div class="panel-head"><div><h3 style="margin:0">Изменить заявку '+esc(request.request_number)+'</h3><div class="subtle">Редактирование доступно до передачи в производство.</div></div><button type="button" class="tiny" data-cancel-request-edit>Отмена</button></div><div class="form-grid"><label>Номер заявки<input name="request_number" required value="'+esc(request.request_number)+'"></label><label>Объект<input name="object_name" required value="'+esc(request.object_name)+'"></label><label>Желаемая дата<input name="desired_date" type="date" required value="'+esc(request.desired_date)+'"></label></div><div style="margin-top:16px"><div class="detail-title">Позиции</div><div data-edit-items></div><button type="button" class="secondary" data-add-edit-item>+ Добавить позицию</button></div><div class="form-actions" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="primary" type="submit">Сохранить изменения</button></div></form>';
   const form=formHost.querySelector<HTMLFormElement>('form')!;const linesHost=form.querySelector<HTMLElement>('[data-edit-items]')!;
   const add=(item?:ItemRow)=>{const line=document.createElement('div');line.className='task-resource-editor';line.style.margin='8px 0';line.innerHTML='<select name="product_id" required><option value="">Номенклатура</option>'+productOptions+'</select><input name="quantity" type="number" min="0.001" step="0.001" required placeholder="Количество"><button type="button" class="tiny" data-remove>Удалить</button>';const select=line.querySelector<HTMLSelectElement>('select')!;const qty=line.querySelector<HTMLInputElement>('input')!;if(item){select.value=item.product_id;qty.value=String(item.quantity);}line.querySelector('[data-remove]')?.addEventListener('click',()=>line.remove());linesHost.appendChild(line);};
   for(const item of requestItems)add(item);if(!requestItems.length)add();
   form.querySelector('[data-add-edit-item]')?.addEventListener('click',()=>add());
   form.querySelector('[data-cancel-request-edit]')?.addEventListener('click',()=>{formHost.hidden=true;});
   form.addEventListener('submit',async event=>{event.preventDefault();const fd=new FormData(form);const rows=[...linesHost.querySelectorAll<HTMLElement>('.task-resource-editor')].map(line=>({productId:String((line.querySelector('select') as HTMLSelectElement).value),quantity:Number((line.querySelector('input') as HTMLInputElement).value)})).filter(x=>x.productId&&x.quantity>0);if(!rows.length){window.alert('Добавьте хотя бы одну позицию');return;}try{await rpc.update({id:request.id,requestNumber:String(fd.get('request_number')??'').trim(),objectName:String(fd.get('object_name')??'').trim(),desiredDate:String(fd.get('desired_date')??''),items:rows});formHost.hidden=true;await load();renderList();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось изменить заявку');}});
 };
 const runRequestFeasibility=async(requestId:string)=>{
   const request=requests.find(r=>r.id===requestId);if(!request)return;
   const hostNode=host.querySelector<HTMLElement>('[data-request-feasibility-result="'+CSS.escape(requestId)+'"]');if(!hostNode)return;
   const plan=plans.find(p=>p.status==='RELEASED')??plans[0];
   if(!plan){hostNode.textContent='Нет доступного операционного плана.';return;}
   hostNode.textContent='Проверяем '+plan.id+'…';
   try{const result=await rpc.checkFeasibility({requestId,planId:plan.id,dueAt:new Date(request.desired_date+'T23:59:59').toISOString()});const rows=Array.isArray(result.items)?result.items as Array<Record<string,unknown>>:[];hostNode.innerHTML=(result.feasible===true?'✓ Выполнимо':'⚠ Не выполнимо')+' · '+rows.map(row=>'позиция '+esc(row.lineNo)+': '+(row.feasible===true?'OK':'блок')+' ('+esc(row.requiredHours)+' ч / '+esc(row.availableHours)+' ч)'+(row.reason?' — '+esc(row.reason):'')).join(' · ');}catch(error){hostNode.textContent=error instanceof Error?error.message:'Ошибка проверки';}
 };
 const renderConvertForm=(itemId:string)=>{const item=items.find(i=>i.id===itemId);if(!item)return;const request=requests.find(r=>r.id===item.request_id);if(!request)return;const pm=productMap();const p=pm.get(item.product_id);const availablePlans=plans.map(plan=>`<option value="${esc(plan.id)}">${esc(plan.id)} · v${plan.version} · ${esc(plan.status)} · до ${dt(plan.horizon_end)}</option>`).join('');const firstPlan=plans.find(p=>p.status!=='ARCHIVED');convertHost.hidden=false;convertHost.innerHTML=`<form class="panel" style="margin:0 0 16px"><div class="panel-head"><div><h3 style="margin:0">Создать производственный заказ</h3><div class="subtle">${esc(request.request_number)} · позиция ${item.line_no} · ${esc(p?.code??item.product_id)} · ${item.quantity} ${esc(p?.unit??'')}</div></div><button type="button" class="tiny" data-cancel-convert>Отмена</button></div>${plans.length?`<div class="form-grid"><label>Операционный план<select name="plan_id" required>${availablePlans}</select></label><label>Номер производственного заказа<input name="order_number" required value="${esc(`${request.request_number}-${item.line_no}`)}"></label><label>Срок<input name="due_at" type="datetime-local" required value="${esc(`${request.desired_date}T23:59`)}"></label><label>Приоритет<select name="priority"><option value="LOW">Низкий</option><option value="NORMAL" selected>Обычный</option><option value="HIGH">Высокий</option><option value="URGENT">Срочный</option></select></label></div><div data-item-feasibility class="subtle" style="margin-top:12px">Проверка выполнимости…</div><div class="production-formation-note">Заказ создаётся только после предварительной проверки маршрута и срока.</div><div class="form-actions" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="primary" type="submit" data-item-submit disabled>Создать и спланировать</button></div>`:'<div class="detail-error">Нет доступного операционного плана. Сначала должен существовать DRAFT или RELEASED план.</div>'}</form>`;if(!plans.length)return;const form=convertHost.querySelector('form')!;const planSelect=form.querySelector<HTMLSelectElement>('[name="plan_id"]')!;if(firstPlan)planSelect.value=firstPlan.id;form.querySelector('[data-cancel-convert]')?.addEventListener('click',()=>{convertHost.hidden=true;});
 const feasibilityHost=form.querySelector<HTMLElement>('[data-item-feasibility]')!;
 const submitItem=form.querySelector<HTMLButtonElement>('[data-item-submit]')!;
 const runItemFeasibility=async()=>{
   feasibilityHost.textContent='Проверяем маршрут и срок…';submitItem.disabled=true;
   try{
     const result=await rpc.checkFeasibility({requestId:request.id,planId:planSelect.value,dueAt:new Date(String((form.querySelector('[name="due_at"]') as HTMLInputElement).value)).toISOString()});
     const rows=Array.isArray(result.items)?result.items as Array<Record<string,unknown>>:[];
     const row=rows.find(x=>String(x.requestItemId)===item.id)||rows[0];
     const ok=row?.feasible===true;
     feasibilityHost.innerHTML=(ok?'✓ Позиция выполнима':'⚠ Позиция не выполнима')+' · требуется '+esc(row?.requiredHours)+' ч, доступно '+esc(row?.availableHours)+' ч'+(row?.reason?' · '+esc(row.reason):'');
     submitItem.disabled=!ok;
   }catch(error){feasibilityHost.textContent=error instanceof Error?error.message:'Не удалось проверить выполнимость';submitItem.disabled=true;}
 };
 form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[name="plan_id"],[name="due_at"]').forEach(field=>field.addEventListener('change',()=>void runItemFeasibility()));
 void runItemFeasibility();
 form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);const orderId=id('ORD');const orderNumber=String(fd.get('order_number')??'').trim();const planId=String(fd.get('plan_id')??'');const dueLocal=String(fd.get('due_at')??'');const priority=String(fd.get('priority')??'NORMAL') as 'LOW'|'NORMAL'|'HIGH'|'URGENT';if(!orderNumber||!planId||!dueLocal){window.alert('Заполните обязательные поля');return;}try{const result=await rpc.createOrderFromItem({requestItemId:itemId,orderId,orderNumber,planId,dueAt:new Date(dueLocal).toISOString(),priority});const createdOrderId=String(result.orderId??orderId);const status=String(result.status??'IMPORTED');if(['IMPORTED','PLANNED','BLOCKED'].includes(status))await orderRpc.planOrder(createdOrderId);convertHost.hidden=true;await load();renderList();const row=host.querySelector<HTMLElement>(`[data-request-row="${CSS.escape(item.request_id)}"]`);row?.scrollIntoView({behavior:'smooth',block:'center'});}catch(err){window.alert(err instanceof Error?err.message:'Не удалось создать производственный заказ');}});};
 host.querySelector('[data-new-request]')?.addEventListener('click',renderNewForm);host.querySelector('[data-request-refresh]')?.addEventListener('click',async()=>{try{await load();renderList();}catch(err){listHost.innerHTML=`<div class="detail-error">${esc(err instanceof Error?err.message:'Ошибка загрузки заявок')}</div>`;}});host.addEventListener('click',event=>{
  const target=event.target as HTMLElement;
  const detailButton=target.closest<HTMLButtonElement>('[data-request-details]');
  if(detailButton){const id=detailButton.dataset.requestDetails??'';const row=host.querySelector<HTMLElement>('[data-request-detail-row="'+CSS.escape(id)+'"]');if(row){const open=row.hidden;row.hidden=!open;if(open)detailsOpen.add(id);else detailsOpen.delete(id);detailButton.textContent=open?'Скрыть':'Детали';}return;}
  const editButton=target.closest<HTMLButtonElement>('[data-request-edit]');
  if(editButton){void renderEditForm(editButton.dataset.requestEdit??'');return;}
  const cancelButton=target.closest<HTMLButtonElement>('[data-request-cancel]');
  if(cancelButton){const id=cancelButton.dataset.requestCancel??'';if(!id)return;if(!window.confirm('Отменить заявку? История сохранится, физического удаления не будет.'))return;void rpc.cancel(id).then(async()=>{await load();renderList();}).catch(error=>window.alert(error instanceof Error?error.message:'Не удалось отменить заявку'));return;}
  const feasButton=target.closest<HTMLButtonElement>('[data-request-feasibility]');
  if(feasButton){void runRequestFeasibility(feasButton.dataset.requestFeasibility??'');return;}
  const convertButton=target.closest<HTMLButtonElement>('[data-convert-item]');
  if(convertButton){renderConvertForm(convertButton.dataset.convertItem??'');convertHost.scrollIntoView({behavior:'smooth',block:'start'});}
});
 subscribeMesRealtime(client,{tables:['production_requests','production_request_items','production_orders','products','operational_plans'],debounceMs:350,onChange:()=>{void load().then(renderList).catch(err=>{listHost.innerHTML=`<div class="detail-error">${esc(err instanceof Error?err.message:'Ошибка обновления заявок')}</div>`;});}});
 try{await load();renderList();}catch(err){listHost.innerHTML=`<div class="detail-error">${esc(err instanceof Error?err.message:'Ошибка загрузки заявок')}</div>`;}
}
