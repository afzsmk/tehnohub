import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesMasterDataRpc, MasterProduct, MasterWorkCenter, MasterRoute, MasterEquipment, MasterEquipmentCapability } from '../integration/mesMasterDataRpc';

const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]??c));

export async function mountMasterTopologyPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client);if(!auth.identity)return;
  const host=document.createElement('section');host.className='panel';root.querySelector('main.page')?.appendChild(host);
  const rpc=new SupabaseMesMasterDataRpc(client);const state={tab:'work_centers'};

  async function load(){
    const [wcR,routeR,productR,eqR,capR,opR]=await Promise.all([
      client.from('work_centers').select('id,external_id,code,name,site_code,description,active').order('code'),
      client.from('routes').select('id,external_id,product_id,code,name,version,active,valid_from,valid_to,description').order('code').order('version'),
      client.from('products').select('id,code,name,unit').order('code'),
      client.from('equipment').select('id,code,name,work_center,work_center_id,capabilities,active').order('code'),
      client.from('equipment_capabilities').select('equipment_id,operation_code,capability_level,valid_from,valid_to,notes').order('equipment_id').order('operation_code'),
      client.from('route_operations').select('id,code,name,route_id').eq('active',true).order('code')
    ]);
    for(const q of [wcR,routeR,productR,eqR,capR,opR])if(q.error)throw q.error;
    const workCenters=(wcR.data??[]) as MasterWorkCenter[];
    const routes=(routeR.data??[]) as MasterRoute[];
    const products=(productR.data??[]) as MasterProduct[];
    const equipment=(eqR.data??[]) as MasterEquipment[];
    const caps=(capR.data??[]) as MasterEquipmentCapability[];
    const operations=(opR.data??[]) as Array<{id:string;code:string;name:string;route_id:string|null}>;
    const productLabel=(id:string)=>products.find(p=>p.id===id)?.code??id;
    const wcLabel=(id:string)=>workCenters.find(w=>w.id===id)?.code??id;
    const equipmentLabel=(id:string)=>equipment.find(e=>e.id===id)?.code??id;
    const tabs=[['work_centers',`Участки (${workCenters.length})`],['equipment',`Оборудование (${equipment.length})`],['routes',`Маршруты (${routes.length})`],['capabilities',`Возможности (${caps.length})`]];
    let body='';

    if(state.tab==='work_centers')body=`<div style="padding:14px 18px"><form id="mt-wc" class="maintenance-form"><input name="id" placeholder="ID" required><input name="external_id" placeholder="External ID"><input name="code" placeholder="Код" required><input name="name" placeholder="Наименование" required><input name="site_code" placeholder="Площадка"><input name="description" placeholder="Описание"><label style="font-size:11px"><input name="active" type="checkbox" checked> активен</label><button class="primary">Сохранить</button></form></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Код</th><th>Участок</th><th>Площадка</th><th>Статус</th></tr></thead><tbody>${workCenters.map(x=>`<tr><td>${esc(x.id)}</td><td><strong>${esc(x.code)}</strong></td><td>${esc(x.name)}</td><td>${esc(x.site_code??'—')}</td><td>${x.active?'Активен':'Неактивен'}</td></tr>`).join('')||'<tr><td colspan="5">Нет данных</td></tr>'}</tbody></table></div>`;

    if(state.tab==='equipment')body=`<div style="padding:14px 18px"><form id="mt-eq" class="maintenance-form"><input name="id" placeholder="ID" required><input name="code" placeholder="Код" required><input name="name" placeholder="Наименование" required><select name="work_center_id" required><option value="">Участок…</option>${workCenters.map(w=>`<option value="${esc(w.id)}">${esc(w.code)} · ${esc(w.name)}</option>`).join('')}</select><input name="capabilities" placeholder="Совместимость, например CUT,BEND"><label style="font-size:11px"><input name="active" type="checkbox" checked> активно</label><button class="primary">Сохранить</button></form></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Код</th><th>Оборудование</th><th>Участок</th><th>Возможности</th><th>Статус</th></tr></thead><tbody>${equipment.map(x=>`<tr><td>${esc(x.id)}</td><td><strong>${esc(x.code)}</strong></td><td>${esc(x.name)}</td><td>${esc(wcLabel(x.work_center_id??x.work_center))}</td><td>${esc(x.capabilities.join(', ')||'—')}</td><td>${x.active?'Активно':'Неактивно'}</td></tr>`).join('')||'<tr><td colspan="6">Нет данных</td></tr>'}</tbody></table></div>`;

    if(state.tab==='routes')body=`<div style="padding:14px 18px"><form id="mt-route" class="maintenance-form"><input name="id" placeholder="ID" required><input name="external_id" placeholder="External ID"><select name="product_id" required><option value="">Продукт…</option>${products.map(p=>`<option value="${esc(p.id)}">${esc(p.code)} — ${esc(p.name)}</option>`).join('')}</select><input name="code" placeholder="Код маршрута" required><input name="name" placeholder="Наименование" required><input name="version" type="number" min="1" value="1" required><input name="valid_from" type="date"><input name="valid_to" type="date"><input name="description" placeholder="Описание"><label style="font-size:11px"><input name="active" type="checkbox" checked> активен</label><button class="primary">Сохранить</button></form></div><div class="table-wrap"><table><thead><tr><th>Код</th><th>Продукт</th><th>Маршрут</th><th>Версия</th><th>Период</th><th>Статус</th></tr></thead><tbody>${routes.map(x=>`<tr><td><strong>${esc(x.code)}</strong></td><td>${esc(productLabel(x.product_id))}</td><td>${esc(x.name)}</td><td>${x.version}</td><td>${esc(x.valid_from??'—')} … ${esc(x.valid_to??'—')}</td><td>${x.active?'Активен':'Неактивен'}</td></tr>`).join('')||'<tr><td colspan="6">Нет данных</td></tr>'}</tbody></table></div>`;

    if(state.tab==='capabilities')body=`<div style="padding:14px 18px"><form id="mt-cap" class="maintenance-form"><select name="equipment_id" required><option value="">Оборудование…</option>${equipment.map(e=>`<option value="${esc(e.id)}">${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select><select name="operation_code" required><option value="">Операция…</option>${operations.map(o=>`<option value="${esc(o.code)}">${esc(o.code)} · ${esc(o.name)}</option>`).join('')}</select><select name="capability_level"><option value="FULL">FULL</option><option value="LIMITED">LIMITED</option><option value="SETUP_ONLY">SETUP_ONLY</option></select><input name="valid_from" type="date"><input name="valid_to" type="date"><input name="notes" placeholder="Комментарий"><button class="primary">Сохранить</button></form></div><div class="table-wrap"><table><thead><tr><th>Оборудование</th><th>Операция</th><th>Уровень</th><th>Период</th><th>Комментарий</th></tr></thead><tbody>${caps.map(x=>`<tr><td>${esc(equipmentLabel(x.equipment_id))}</td><td><strong>${esc(x.operation_code)}</strong></td><td>${esc(x.capability_level)}</td><td>${esc(x.valid_from??'—')} … ${esc(x.valid_to??'—')}</td><td>${esc(x.notes??'—')}</td></tr>`).join('')||'<tr><td colspan="5">Нет данных</td></tr>'}</tbody></table></div>`;

    host.innerHTML=`<div class="panel-head"><div><h2>Технологическая НСИ</h2><div class="subtle">Участки, оборудование, маршруты и возможности · роль ${esc(auth.identity!.role)}</div></div><button class="primary" id="mt-refresh">Обновить</button></div><div class="dispatch-toolbar"><div>${tabs.map(([id,label])=>`<button class="tiny ${state.tab===id?'primary':''}" data-mt-tab="${id}">${label}</button>`).join('')}</div></div>${body}`;
    host.querySelectorAll<HTMLButtonElement>('[data-mt-tab]').forEach(btn=>btn.addEventListener('click',()=>{state.tab=btn.dataset.mtTab??'work_centers';void load();}));
    host.querySelector<HTMLButtonElement>('#mt-refresh')?.addEventListener('click',()=>void load());

    const wcForm=host.querySelector<HTMLFormElement>('#mt-wc');wcForm?.addEventListener('submit',async ev=>{ev.preventDefault();const f=new FormData(wcForm);await rpc.saveWorkCenter({id:String(f.get('id')||''),external_id:String(f.get('external_id')||'')||null,code:String(f.get('code')||''),name:String(f.get('name')||''),site_code:String(f.get('site_code')||'')||null,description:String(f.get('description')||'')||null,active:f.get('active')==='on'});await load();});
    const eqForm=host.querySelector<HTMLFormElement>('#mt-eq');eqForm?.addEventListener('submit',async ev=>{ev.preventDefault();const f=new FormData(eqForm);const caps=String(f.get('capabilities')||'').split(',').map(x=>x.trim()).filter(Boolean);await rpc.saveEquipmentNormalized({id:String(f.get('id')||''),code:String(f.get('code')||''),name:String(f.get('name')||''),work_center:'',work_center_id:String(f.get('work_center_id')||''),capabilities:caps,active:f.get('active')==='on'});await load();});
    const routeForm=host.querySelector<HTMLFormElement>('#mt-route');routeForm?.addEventListener('submit',async ev=>{ev.preventDefault();const f=new FormData(routeForm);await rpc.saveRoute({id:String(f.get('id')||''),external_id:String(f.get('external_id')||'')||null,product_id:String(f.get('product_id')||''),code:String(f.get('code')||''),name:String(f.get('name')||''),version:Number(f.get('version')||1),active:f.get('active')==='on',valid_from:String(f.get('valid_from')||'')||null,valid_to:String(f.get('valid_to')||'')||null,description:String(f.get('description')||'')||null});await load();});
    const capForm=host.querySelector<HTMLFormElement>('#mt-cap');capForm?.addEventListener('submit',async ev=>{ev.preventDefault();const f=new FormData(capForm);await rpc.saveEquipmentCapability({equipment_id:String(f.get('equipment_id')||''),operation_code:String(f.get('operation_code')||''),capability_level:String(f.get('capability_level')||'FULL'),valid_from:String(f.get('valid_from')||'')||null,valid_to:String(f.get('valid_to')||'')||null,notes:String(f.get('notes')||'')||null});await load();});
  }
  try{await load();}catch(e){host.innerHTML=`<div class="panel-head"><div><h2>Технологическая НСИ</h2><div style="color:#b91c1c">${esc(e instanceof Error?e.message:'Не удалось загрузить НСИ')}</div></div></div>`;}
}
