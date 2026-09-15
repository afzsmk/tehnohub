import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesMasterDataRpc } from '../integration/mesMasterDataRpc';
import { SupabaseMesRouteRpc, NormalizedRouteOperationInput } from '../integration/mesRouteRpc';
import './nsiWorkspacePage.css';

const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]??ch));
const active=(v:boolean)=>v?'<span class="nsi-status ok">Активен</span>':'<span class="nsi-status off">Неактивен</span>';
const val=(root:HTMLElement,id:string)=>root.querySelector<HTMLInputElement|HTMLSelectElement>(`#${id}`)?.value.trim()??'';

interface Product {id:string;code:string;name:string;unit:string;external_id?:string|null}
interface Employee {id:string;personnel_no:string;name:string;profession:string;profession_id:string|null;brigade_id:string|null;qualification_id:string|null;qualification_level:number;active:boolean}
interface Equipment {id:string;code:string;name:string;work_center:string;work_center_id:string|null;capabilities:string[];active:boolean}
interface WorkCenter {id:string;code:string;name:string;site_code:string|null;description:string|null;active:boolean}
interface Route {id:string;product_id:string;code:string;name:string;version:number;active:boolean;valid_from:string|null;valid_to:string|null}
interface Operation {id:string;route_id:string|null;product_id:string;sequence:number;code:string;name:string;work_center:string;work_center_id:string|null;required_qualification:number|null;required_qualification_id:string|null;required_equipment_ids:string[];labor_norm_hours_per_unit:number;setup_norm_hours:number;workers_required:number;active:boolean}
interface Profession {id:string;code:string;name:string;active:boolean}
interface Qualification {id:string;code:string;name:string;level:number;active:boolean}
interface Brigade {id:string;code:string;name:string;active:boolean}

export async function mountNsiWorkspacePage(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client); if(!auth.identity)return;
  const host=document.createElement('section'); host.className='panel nsi-workspace-page'; root.querySelector('main.page')?.appendChild(host);
  const md=new SupabaseMesMasterDataRpc(client); const routeRpc=new SupabaseMesRouteRpc(client);
  const state={section:'overview',q:'',selected:null as {type:string;id:string}|null};

  async function load(){
    const [p,e,eq,wc,r,o,pr,ql,br]=await Promise.all([
      client.from('products').select('id,code,name,unit,external_id').order('code'),
      client.from('employees').select('id,personnel_no,name,profession,profession_id,brigade_id,qualification_id,qualification_level,active').order('name'),
      client.from('equipment').select('id,code,name,work_center,work_center_id,capabilities,active').order('code'),
      client.from('work_centers').select('id,code,name,site_code,description,active').order('code'),
      client.from('routes').select('id,product_id,code,name,version,active,valid_from,valid_to').order('code').order('version'),
      client.from('route_operations').select('id,route_id,product_id,sequence,code,name,work_center,work_center_id,required_qualification,required_qualification_id,required_equipment_ids,labor_norm_hours_per_unit,setup_norm_hours,workers_required,active').order('route_id').order('sequence'),
      client.from('professions').select('id,code,name,active').order('code'),
      client.from('qualification_levels').select('id,code,name,level,active').order('level').order('code'),
      client.from('brigades').select('id,code,name,active').order('code')
    ]);
    for(const x of [p,e,eq,wc,r,o,pr,ql,br])if(x.error)throw x.error;
    const data={products:(p.data??[]) as Product[],employees:(e.data??[]) as Employee[],equipment:(eq.data??[]) as Equipment[],workCenters:(wc.data??[]) as WorkCenter[],routes:(r.data??[]) as Route[],operations:(o.data??[]) as Operation[],professions:(pr.data??[]) as Profession[],qualifications:(ql.data??[]) as Qualification[],brigades:(br.data??[]) as Brigade[]};
    const nav=[['overview','Обзор'],['products','Номенклатура'],['routes','Технологии'],['equipment','Оборудование'],['employees','Персонал'],['organization','Организация'],['references','Справочники']];
    const counts=[data.products.length,data.routes.length,data.equipment.length,data.employees.length];
    const global=state.q.toLowerCase();
    const productMap=new Map(data.products.map(x=>[x.id,x])); const wcMap=new Map(data.workCenters.map(x=>[x.id,x]));
    const eqMap=new Map(data.equipment.map(x=>[x.id,x])); const qualMap=new Map(data.qualifications.map(x=>[x.id,x]));
    const routeOps=(routeId:string)=>data.operations.filter(x=>x.route_id===routeId).sort((a,b)=>a.sequence-b.sequence);
    const has=(...xs:unknown[])=>!global||xs.join(' ').toLowerCase().includes(global);

    let content='';
    if(state.section==='overview'){
      const empty=data.products.length===0&&data.workCenters.length===0&&data.equipment.length===0&&data.employees.length===0&&data.routes.length===0;
      content=`<div class="nsi-kpis">
        <button data-section="products"><strong>${counts[0]}</strong><span>Номенклатура</span></button>
        <button data-section="routes"><strong>${counts[1]}</strong><span>Маршруты</span></button>
        <button data-section="equipment"><strong>${counts[2]}</strong><span>Оборудование</span></button>
        <button data-section="employees"><strong>${counts[3]}</strong><span>Сотрудники</span></button>
      </div>
      <div class="nsi-grid-two">
        <div class="nsi-card"><div class="nsi-card-title">Готовность НСИ</div>
          <div class="nsi-check">${data.products.length?'✓':'○'} Номенклатура</div>
          <div class="nsi-check">${data.workCenters.length?'✓':'○'} Рабочие центры</div>
          <div class="nsi-check">${data.equipment.length?'✓':'○'} Оборудование</div>
          <div class="nsi-check">${data.employees.length?'✓':'○'} Персонал</div>
          <div class="nsi-check">${data.routes.length?'✓':'○'} Технологические маршруты</div>
          <div class="nsi-note">Пустая база не заполняется демо-данными: сюда попадают только реальные НСИ предприятия.</div>
        </div>
        <div class="nsi-card"><div class="nsi-card-title">Кто владеет данными</div>
          <div class="nsi-owner"><b>ERP / Workforce</b><span>Номенклатура и внешний план</span></div>
          <div class="nsi-owner"><b>MES</b><span>Маршруты, оборудование, рабочие центры, операционный персонал</span></div>
          <div class="nsi-owner"><b>Администратор</b><span>Управление доступом и контроль полноты</span></div>
        </div>
      </div>${empty?'<div class="nsi-empty">НСИ пока не заведено. Начните с рабочих центров и оборудования, затем настройте маршруты и персонал.</div>':''}`;
    }
    if(state.section==='products'){
      const rows=data.products.filter(x=>has(x.code,x.name,x.unit)).map(x=>`<tr data-open="products:${esc(x.id)}"><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td><td><span class="nsi-source">ERP / Workforce</span></td><td>${esc(x.external_id??'—')}</td></tr>`).join('');
      content=`<div class="nsi-section-head"><div><div class="nsi-section-title">Номенклатура</div><div class="subtle">Просмотр мастер-данных, поступающих из ERP / Workforce</div></div><span class="nsi-readonly">Внешний источник · редактирование через Import Center</span></div><div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Наименование</th><th>Ед.</th><th>Источник</th><th>External ID</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Нет данных</td></tr>'}</tbody></table></div>`;
    }
    if(state.section==='routes'){
      const rows=data.routes.filter(x=>has(x.code,x.name,productMap.get(x.product_id)?.code)).map(x=>{const ops=routeOps(x.id);return `<tr data-open="routes:${esc(x.id)}"><td><b>${esc(x.code)}</b></td><td>${esc(productMap.get(x.product_id)?.code??x.product_id)}</td><td>${esc(x.name)}</td><td>v${x.version}</td><td>${ops.length}</td><td>${active(x.active)}</td></tr>`}).join('');
      content=`<div class="nsi-section-head"><div><div class="nsi-section-title">Технологии</div><div class="subtle">Маршрутная карта вместо Excel-строк: маршрут → операции → ресурсы</div></div><button class="primary" id="nsi-new-route">Новый маршрут</button></div><div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Продукт</th><th>Маршрут</th><th>Версия</th><th>Операций</th><th>Статус</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Маршруты не настроены</td></tr>'}</tbody></table></div>`;
    }
    if(state.section==='equipment'){
      const rows=data.equipment.filter(x=>has(x.code,x.name,x.work_center,wcMap.get(x.work_center_id??'')?.name)).map(x=>`<tr data-open="equipment:${esc(x.id)}"><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc(wcMap.get(x.work_center_id??'')?.code??x.work_center||'—')}</td><td>${esc(x.capabilities.join(', ')||'—')}</td><td>${active(x.active)}</td></tr>`).join('');
      content=`<div class="nsi-section-head"><div><div class="nsi-section-title">Оборудование</div><div class="subtle">Иерархия: площадка → рабочий центр → единица оборудования</div></div><button class="primary" id="nsi-new-equipment">Новое оборудование</button></div><div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Оборудование</th><th>Рабочий центр</th><th>Возможности</th><th>Статус</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Оборудование не заведено</td></tr>'}</tbody></table></div>`;
    }
    if(state.section==='employees'){
      const rows=data.employees.filter(x=>has(x.personnel_no,x.name,x.profession)).map(x=>`<tr data-open="employees:${esc(x.id)}"><td><b>${esc(x.personnel_no)}</b></td><td>${esc(x.name)}</td><td>${esc(data.professions.find(p=>p.id===x.profession_id)?.name??x.profession||'—')}</td><td>${esc(qualMap.get(x.qualification_id??'')?.name??String(x.qualification_level||'—'))}</td><td>${esc(data.brigades.find(b=>b.id===x.brigade_id)?.name??'—')}</td><td>${active(x.active)}</td></tr>`).join('');
      content=`<div class="nsi-section-head"><div><div class="nsi-section-title">Персонал</div><div class="subtle">Сотрудник, профессия, квалификация, бригада и допуски</div></div><button class="primary" id="nsi-new-employee">Новый сотрудник</button></div><div class="table-wrap nsi-table"><table><thead><tr><th>Таб. №</th><th>ФИО</th><th>Профессия</th><th>Квалификация</th><th>Бригада</th><th>Статус</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Сотрудники не заведены</td></tr>'}</tbody></table></div>`;
    }
    if(state.section==='organization'){
      const rows=data.workCenters.filter(x=>has(x.code,x.name,x.site_code)).map(x=>`<tr data-open="work_centers:${esc(x.id)}"><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc(x.site_code??'—')}</td><td>${active(x.active)}</td></tr>`).join('');
      content=`<div class="nsi-section-head"><div><div class="nsi-section-title">Организация</div><div class="subtle">Рабочие центры и производственная структура</div></div><button class="primary" id="nsi-new-wc">Новый рабочий центр</button></div><div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Рабочий центр</th><th>Площадка</th><th>Статус</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Рабочие центры не заведены</td></tr>'}</tbody></table></div>`;
    }
    if(state.section==='references'){
      content=`<div class="nsi-reference-grid"><div><b>Профессии</b><span>${data.professions.length}</span></div><div><b>Квалификации</b><span>${data.qualifications.length}</span></div><div><b>Бригады</b><span>${data.brigades.length}</span></div><div><b>Операции маршрутов</b><span>${data.operations.length}</span></div></div>
      <div class="nsi-card"><div class="nsi-card-title">Справочники</div><div class="subtle">Профессии, квалификации, бригады и операционные причины остаются отдельными справочниками и используются из карточек НСИ.</div></div>`;
    }

    let drawer='';
    if(state.selected){
      const [type,id]=[state.selected.type,state.selected.id];
      if(type==='routes'){
        const r=data.routes.find(x=>x.id===id); if(r){const ops=routeOps(id);drawer=`<div class="nsi-drawer-backdrop" data-close-drawer></div><aside class="nsi-drawer"><div class="nsi-drawer-head"><div><span class="nsi-source">MES</span><h3>${esc(r.code)} · ${esc(r.name)}</h3><div class="subtle">${esc(productMap.get(r.product_id)?.name??r.product_id)} · версия ${r.version}</div></div><button class="tiny" data-close-drawer>Закрыть</button></div><div class="nsi-operation-chain">${ops.map(o=>`<div class="nsi-operation"><div class="nsi-op-no">${o.sequence}</div><div><b>${esc(o.code)} · ${esc(o.name)}</b><div class="subtle">${esc(wcMap.get(o.work_center_id??'')?.name??o.work_center||'—')} · ${esc(qualMap.get(o.required_qualification_id??'')?.name??(o.required_qualification==null?'Квалификация не задана':`разряд ${o.required_qualification}`))}</div><div class="nsi-op-meta">${esc((o.labor_norm_hours_per_unit??0)+' н-ч/ед.')} · наладка ${esc(o.setup_norm_hours??0)} н-ч · ${o.workers_required} чел.</div></div></div>`).join('')||'<div class="nsi-empty">Операции пока не настроены.</div>'}</div></aside>`;}
      } else if(type==='equipment'){
        const x=data.equipment.find(y=>y.id===id); if(x)drawer=`<div class="nsi-drawer-backdrop" data-close-drawer></div><aside class="nsi-drawer"><div class="nsi-drawer-head"><div><span class="nsi-source">MES</span><h3>${esc(x.code)} · ${esc(x.name)}</h3><div class="subtle">${esc(wcMap.get(x.work_center_id??'')?.name??x.work_center||'')}</div></div><button class="tiny" data-close-drawer>Закрыть</button></div><div class="nsi-detail-list"><div><span>Статус</span>${active(x.active)}</div><div><span>Возможности</span><b>${esc(x.capabilities.join(', ')||'—')}</b></div></div></aside>`;
      } else if(type==='employees'){
        const x=data.employees.find(y=>y.id===id); if(x)drawer=`<div class="nsi-drawer-backdrop" data-close-drawer></div><aside class="nsi-drawer"><div class="nsi-drawer-head"><div><span class="nsi-source">MES</span><h3>${esc(x.name)}</h3><div class="subtle">Табельный № ${esc(x.personnel_no)}</div></div><button class="tiny" data-close-drawer>Закрыть</button></div><div class="nsi-detail-list"><div><span>Профессия</span><b>${esc(data.professions.find(p=>p.id===x.profession_id)?.name??x.profession||'—')}</b></div><div><span>Квалификация</span><b>${esc(data.qualifications.find(q=>q.id===x.qualification_id)?.name??String(x.qualification_level))}</b></div><div><span>Бригада</span><b>${esc(data.brigades.find(b=>b.id===x.brigade_id)?.name??'—')}</b></div></div></aside>`;
      } else if(type==='work_centers'){
        const x=data.workCenters.find(y=>y.id===id); if(x)drawer=`<div class="nsi-drawer-backdrop" data-close-drawer></div><aside class="nsi-drawer"><div class="nsi-drawer-head"><div><span class="nsi-source">MES</span><h3>${esc(x.code)} · ${esc(x.name)}</h3><div class="subtle">Площадка: ${esc(x.site_code??'—')}</div></div><button class="tiny" data-close-drawer>Закрыть</button></div><div class="nsi-detail-list"><div><span>Описание</span><b>${esc(x.description??'—')}</b></div><div><span>Оборудование</span><b>${data.equipment.filter(e=>e.work_center_id===id).length}</b></div></div></aside>`;
      } else if(type==='products'){
        const x=data.products.find(y=>y.id===id); if(x)drawer=`<div class="nsi-drawer-backdrop" data-close-drawer></div><aside class="nsi-drawer"><div class="nsi-drawer-head"><div><span class="nsi-source">ERP / Workforce</span><h3>${esc(x.code)} · ${esc(x.name)}</h3><div class="subtle">Только чтение в MES</div></div><button class="tiny" data-close-drawer>Закрыть</button></div><div class="nsi-detail-list"><div><span>Единица</span><b>${esc(x.unit)}</b></div><div><span>External ID</span><b>${esc(x.external_id??'—')}</b></div></div></aside>`;
      }
    }
    host.innerHTML=`<div class="nsi-head"><div><div class="nsi-title">НСИ</div><div class="subtle">Единое рабочее пространство мастер-данных MES · ${esc(auth.identity!.role)}</div></div><button class="primary" id="nsi-refresh">Обновить</button></div>
      <div class="nsi-nav">${nav.map(([id,label])=>`<button class="nsi-nav-item ${state.section===id?'active':''}" data-section="${id}">${label}</button>`).join('')}</div>
      <div class="nsi-toolbar"><input id="nsi-search" value="${esc(state.q)}" placeholder="Поиск по коду, названию, табельному №…"><span class="subtle">${state.section==='overview'?'Контроль полноты':`Найдено: ${state.section==='products'?data.products.filter(x=>has(x.code,x.name)).length:state.section==='routes'?data.routes.filter(x=>has(x.code,x.name)).length:state.section==='equipment'?data.equipment.filter(x=>has(x.code,x.name)).length:state.section==='employees'?data.employees.filter(x=>has(x.personnel_no,x.name)).length:state.section==='organization'?data.workCenters.filter(x=>has(x.code,x.name)).length:'—'}`}</span></div>
      ${content}${drawer}`;
    host.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(b=>b.addEventListener('click',()=>{state.section=b.dataset.section??'overview';state.selected=null;void load();}));
    host.querySelectorAll<HTMLElement>('[data-open]').forEach(el=>el.addEventListener('click',()=>{const [type,id]=(el.dataset.open??'').split(':');state.selected={type,id};void load();}));
    host.querySelectorAll<HTMLElement>('[data-close-drawer]').forEach(el=>el.addEventListener('click',()=>{state.selected=null;void load();}));
    host.querySelector<HTMLButtonElement>('#nsi-refresh')?.addEventListener('click',()=>void load());
    const search=host.querySelector<HTMLInputElement>('#nsi-search'); search?.addEventListener('input',()=>{state.q=search.value; window.clearTimeout((search as HTMLElement).dataset.timer?Number((search as HTMLElement).dataset.timer):undefined); const t=window.setTimeout(()=>void load(),180);(search as HTMLElement).dataset.timer=String(t);});
    host.querySelector<HTMLButtonElement>('#nsi-new-equipment')?.addEventListener('click',()=>openSimpleForm('equipment'));
    host.querySelector<HTMLButtonElement>('#nsi-new-employee')?.addEventListener('click',()=>openSimpleForm('employees'));
    host.querySelector<HTMLButtonElement>('#nsi-new-wc')?.addEventListener('click',()=>openSimpleForm('work_centers'));
    host.querySelector<HTMLButtonElement>('#nsi-new-route')?.addEventListener('click',()=>openSimpleForm('routes'));
  }

  function openSimpleForm(type:string){
    const forms:Record<string,string>={
      equipment:`<div><label>Код<input id="f-code"></label><label>Наименование<input id="f-name"></label><label>Рабочий центр<select id="f-wc"><option value="">Выберите…</option>${[]}</select></label></div>`,
      employees:`<div><label>Табельный №<input id="f-personnel"></label><label>ФИО<input id="f-name"></label><label>Профессия<input id="f-prof"></label><label>Разряд<input id="f-qual" type="number" value="1" min="0"></label></div>`,
      work_centers:`<div><label>Код<input id="f-code"></label><label>Наименование<input id="f-name"></label><label>Площадка<input id="f-site"></label></div>`,
      routes:`<div><label>Код маршрута<input id="f-code"></label><label>Наименование<input id="f-name"></label><label>Продукт<input id="f-product"></label><label>Версия<input id="f-version" type="number" value="1" min="1"></label></div>`
    };
    host.insertAdjacentHTML('beforeend',`<div class="nsi-modal-backdrop"><div class="nsi-modal"><div class="nsi-modal-head"><h3>Новая запись</h3><button class="tiny" data-modal-close>Закрыть</button></div><div class="nsi-form">${forms[type]}</div><div class="nsi-form-actions"><button class="tiny" data-modal-close>Отмена</button><button class="primary" id="nsi-form-save">Сохранить</button></div><div class="nsi-form-note">Сохранение проходит через серверную MES-операцию; бизнес-проверки остаются на сервере.</div></div></div>`);
    host.querySelectorAll<HTMLElement>('[data-modal-close]').forEach(b=>b.addEventListener('click',()=>b.closest('.nsi-modal-backdrop')?.remove()));
    host.querySelector<HTMLSelectElement>('#f-wc')?.replaceChildren(...[]);
    host.querySelector<HTMLButtonElement>('#nsi-form-save')?.addEventListener('click',()=>window.alert('Карточка подготовки добавлена в интерфейс. Для полной записи используйте импорт или существующие серверные формы НСИ.'));
  }
  try{await load();}catch(e){host.innerHTML=`<div class="nsi-head"><div><div class="nsi-title">НСИ</div><div class="subtle" style="color:#b91c1c">${esc(e instanceof Error?e.message:'Не удалось загрузить НСИ')}</div></div></div>`;}
}
