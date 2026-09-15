import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesProductionRequestRpc } from '../integration/mesProductionRequestRpc';
import './ordersPage.css';

const ROLES=['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'];
type Product={id:string;code:string;name:string;unit:string};
const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]??c));

export async function mountProductionRequestsPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
 const auth=await getMesAuthState(client,{hydrateSnapshot:false});
 if(!auth.identity || !ROLES.includes(auth.identity.role) || root.querySelector('.production-requests-page')) return;
 const {data,error}=await client.from('products').select('id,code,name,unit').order('code');
 if(error) throw error;
 const products=(data??[]) as Product[];
 const rpc=new SupabaseMesProductionRequestRpc(client);
 const host=document.createElement('section');host.className='panel production-requests-page';
 host.innerHTML=`<div class="panel-head"><div><h2>Заявки на изготовление</h2><div class="subtle">Объект · номер заявки · номенклатура · количество · желаемая дата</div></div><button class="primary" id="new-production-request">Новая заявка</button></div><div class="subtle" style="padding:0 0 14px">Заявка является входным документом. После проверки и планирования её позиции могут быть преобразованы в производственные заказы.</div><div id="production-request-form" hidden></div>`;
 root.appendChild(host);
 const formHost=host.querySelector<HTMLElement>('#production-request-form')!;
 const productOptions=products.map(p=>`<option value="${esc(p.id)}">${esc(p.code)} — ${esc(p.name)} (${esc(p.unit)})</option>`).join('');
 const renderForm=()=>{
  formHost.innerHTML=`<form class="panel" style="margin:0 0 16px"><div class="panel-head"><div><h3 style="margin:0">Новая заявка</h3><div class="subtle">Можно добавить несколько позиций номенклатуры.</div></div><button type="button" class="tiny" id="cancel-production-request">Отмена</button></div><div class="form-grid"><label>Номер заявки<input name="request_number" required></label><label>Наименование объекта<input name="object_name" required></label><label>Желаемая дата<input name="desired_date" type="date" required></label></div><div style="margin-top:16px"><div class="detail-title">Изделия</div><div id="request-items"></div><button type="button" class="secondary" id="add-request-item">+ Добавить изделие</button></div><div class="form-actions" style="display:flex;justify-content:flex-end;margin-top:16px"><button class="primary" type="submit">Сохранить заявку</button></div></form>`;
  const form=formHost.querySelector('form') as HTMLFormElement; const itemsHost=form.querySelector<HTMLElement>('#request-items')!; let lines:HTMLDivElement[]=[];
  const addLine=()=>{ const line=document.createElement('div');line.className='task-resource-editor';line.style.margin='8px 0';line.innerHTML=`<select name="product_id" required><option value="">Номенклатура</option>${productOptions}</select><input name="quantity" type="number" min="0.001" step="0.001" placeholder="Количество" required><button type="button" class="tiny" data-remove>Удалить</button>`;line.querySelector('[data-remove]')?.addEventListener('click',()=>{line.remove();lines=lines.filter(x=>x!==line);});itemsHost.appendChild(line);lines.push(line);};
  addLine();
  form.querySelector('#add-request-item')?.addEventListener('click',addLine);
  form.querySelector('#cancel-production-request')?.addEventListener('click',()=>{formHost.hidden=true;});
  form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);const items=lines.map(line=>({productId:String((line.querySelector('[name="product_id"]') as HTMLSelectElement).value),quantity:Number((line.querySelector('[name="quantity"]') as HTMLInputElement).value)})).filter(x=>x.productId && x.quantity>0);if(items.length===0){window.alert('Добавьте хотя бы одно изделие');return;}try{await rpc.create({id:crypto.randomUUID(),requestNumber:String(fd.get('request_number')??'').trim(),objectName:String(fd.get('object_name')??'').trim(),desiredDate:String(fd.get('desired_date')??''),items});window.alert('Заявка сохранена');formHost.hidden=true;}catch(err){window.alert(err instanceof Error?err.message:'Не удалось сохранить заявку');}});
 };
 host.querySelector('#new-production-request')?.addEventListener('click',()=>{formHost.hidden=false;renderForm();formHost.scrollIntoView({behavior:'smooth',block:'start'});});
} 
