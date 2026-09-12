import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product, RouteOperation } from '../types';
import { SupabaseMesRouteRpc, NormalizedRouteOperationInput } from '../integration/mesRouteRpc';

interface DbRow {
  id:string; product_id:string; sequence:number; code:string; name:string; work_center:string;
  work_center_id:string|null; route_id:string|null; required_qualification:number|null; required_qualification_id:string|null;
  required_equipment_ids:unknown; setup_minutes:number; run_minutes_per_unit:number; active:boolean;
  labor_norm_hours_per_unit:number; setup_norm_hours:number; workers_required:number;
}
interface RouteRow { id:string; product_id:string; code:string; name:string; version:number; active:boolean; }
interface WorkCenterRow { id:string; code:string; name:string; active:boolean; }
interface QualificationRow { id:string; code:string; name:string; level:number; active:boolean; }
interface EquipmentRow { id:string; code:string; name:string; active:boolean; }

const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]??ch));
const toArray=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):[];
const selected=(a:string|undefined,b:string|undefined)=>a&&b&&a===b?' selected':'';

function map(r:DbRow):RouteOperation&{productId:string;active:boolean;routeId?:string;workCenterId?:string;requiredQualificationId?:string} {
  return {
    id:r.id,productId:r.product_id,sequence:Number(r.sequence),code:r.code,name:r.name,workCenter:r.work_center,
    requiredQualification:r.required_qualification==null?undefined:Number(r.required_qualification),
    requiredEquipmentIds:toArray(r.required_equipment_ids),laborNormHoursPerUnit:Number(r.labor_norm_hours_per_unit),
    setupNormHours:Number(r.setup_norm_hours),workersRequired:Number(r.workers_required),setupMinutes:Number(r.setup_minutes),
    runMinutesPerUnit:Number(r.run_minutes_per_unit),active:r.active,routeId:r.route_id??undefined,workCenterId:r.work_center_id??undefined,
    requiredQualificationId:r.required_qualification_id??undefined,
  };
}

export async function mountRouteEditor(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const host=document.createElement('section');host.className='panel';root.querySelector('main.page')?.appendChild(host);
  const rpc=new SupabaseMesRouteRpc(client);
  async function load(){
    const [{data:productsData,error:productsError},{data:routesData,error:routesError},{data:wcData,error:wcError},{data:qualData,error:qualError},{data:eqData,error:eqError},{data:opsData,error:opsError}]=await Promise.all([
      client.from('products').select('id,code,name,unit').order('code'),
      client.from('routes').select('id,product_id,code,name,version,active').eq('active',true).order('code').order('version'),
      client.from('work_centers').select('id,code,name,active').eq('active',true).order('code'),
      client.from('qualification_levels').select('id,code,name,level,active').eq('active',true).order('level').order('code'),
      client.from('equipment').select('id,code,name,active').eq('active',true).order('code'),
      client.from('route_operations').select('*').order('route_id').order('product_id').order('sequence')
    ]);
    for(const q of [productsError,routesError,wcError,qualError,eqError,opsError])if(q)throw q;
    const products=(productsData??[]) as Product[];
    const routes=(routesData??[]) as RouteRow[];
    const workCenters=(wcData??[]) as WorkCenterRow[];
    const qualifications=(qualData??[]) as QualificationRow[];
    const equipment=(eqData??[]) as EquipmentRow[];
    const operations=(opsData??[]).map(r=>map(r as DbRow));
    const productById=new Map(products.map(p=>[p.id,p]));
    const routeById=new Map(routes.map(r=>[r.id,r]));
    const wcById=new Map(workCenters.map(x=>[x.id,x]));
    const qualById=new Map(qualifications.map(x=>[x.id,x]));
    const eqById=new Map(equipment.map(x=>[x.id,x]));

    host.innerHTML=`
      <div class="panel-head"><div><h2>Технологические маршруты</h2><div class="subtle">${operations.length} операций · маршрут → операция → участок → оборудование → квалификация · трудовое нормирование в н-ч</div></div></div>
      <div class="route-editor-form">
        <input id="route-id" placeholder="ID операции" required>
        <select id="route-route" required><option value="">Маршрут…</option>${routes.map(r=>`<option value="${esc(r.id)}">${esc(r.code)} v${r.version} · ${esc(productById.get(r.product_id)?.code??r.product_id)}</option>`).join('')}</select>
        <select id="route-work-center" required><option value="">Участок…</option>${workCenters.map(w=>`<option value="${esc(w.id)}">${esc(w.code)} · ${esc(w.name)}</option>`).join('')}</select>
        <select id="route-qualification"><option value="">Квалификация…</option>${qualifications.map(q=>`<option value="${esc(q.id)}">${esc(q.code)} · ${esc(q.name)}</option>`).join('')}</select>
        <input id="route-sequence" type="number" min="1" value="10" placeholder="№">
        <input id="route-code" placeholder="Код операции" required>
        <input id="route-name" placeholder="Операция" required>
        <select id="route-equipment" multiple size="3">${equipment.map(e=>`<option value="${esc(e.id)}">${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select>
        <input id="route-labor" type="number" min="0" step="0.000001" placeholder="н-ч/ед." required>
        <input id="route-setup-norm" type="number" min="0" step="0.000001" placeholder="Наладка, н-ч" value="0" required>
        <input id="route-workers" type="number" min="1" step="1" placeholder="Рабочих" value="1" required>
        <button id="route-save" class="primary" type="button">Сохранить</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Маршрут</th><th>Продукт</th><th>№</th><th>Код</th><th>Операция</th><th>Участок</th><th>Квалификация</th><th>Оборудование</th><th>н-ч/ед.</th><th>Наладка, н-ч</th><th>Рабочих</th><th></th></tr></thead><tbody>
      ${operations.map(o=>{
        const route=o.routeId?routeById.get(o.routeId):undefined;
        return `<tr><td>${esc(route?`${route.code} v${route.version}`:'—')}</td><td>${esc(productById.get(o.productId)?.code??o.productId)}</td><td>${o.sequence}</td><td>${esc(o.code)}</td><td>${esc(o.name)}</td><td>${esc(wcById.get(o.workCenterId??'')?.code??o.workCenter)}</td><td>${esc(qualById.get(o.requiredQualificationId??'')?.code??String(o.requiredQualification??'—'))}</td><td>${esc(o.requiredEquipmentIds.map(id=>eqById.get(id)?.code??id).join(', '))}</td><td>${o.laborNormHoursPerUnit}</td><td>${o.setupNormHours}</td><td>${o.workersRequired}</td><td><button class="tiny" data-edit-route="${esc(o.id)}">Изменить</button> <button class="tiny danger-button" data-remove-route="${esc(o.id)}">Удалить</button></td></tr>`;
      }).join('')||'<tr><td colspan="12">Операции не настроены</td></tr>'}
      </tbody></table></div>`;

    const value=(id:string)=>host.querySelector<HTMLInputElement|HTMLSelectElement>(`#${id}`)?.value.trim()??'';
    const multiValues=(id:string)=>Array.from(host.querySelector<HTMLSelectElement>(`#${id}`)?.selectedOptions??[]).map(x=>x.value).filter(Boolean);
    const reset=()=>{for(const id of ['route-id','route-code','route-name','route-labor','route-setup-norm']){const el=host.querySelector<HTMLInputElement>(`#${id}`);if(el)el.value=id==='route-setup-norm'?'0':'';} const seq=host.querySelector<HTMLInputElement>('#route-sequence');if(seq)seq.value='10';const workers=host.querySelector<HTMLInputElement>('#route-workers');if(workers)workers.value='1';for(const id of ['route-route','route-work-center','route-qualification']){const el=host.querySelector<HTMLSelectElement>(`#${id}`);if(el)el.value='';}const eq=host.querySelector<HTMLSelectElement>('#route-equipment');if(eq)Array.from(eq.options).forEach(o=>o.selected=false);};
    reset();
    host.querySelectorAll<HTMLButtonElement>('[data-edit-route]').forEach(btn=>btn.addEventListener('click',()=>{const o=operations.find(x=>x.id===btn.dataset.editRoute);if(!o)return;const id=host.querySelector<HTMLInputElement>('#route-id');if(id)id.value=o.id;const route=host.querySelector<HTMLSelectElement>('#route-route');if(route)route.value=o.routeId??'';const wc=host.querySelector<HTMLSelectElement>('#route-work-center');if(wc)wc.value=o.workCenterId??'';const q=host.querySelector<HTMLSelectElement>('#route-qualification');if(q)q.value=o.requiredQualificationId??'';const seq=host.querySelector<HTMLInputElement>('#route-sequence');if(seq)seq.value=String(o.sequence);const code=host.querySelector<HTMLInputElement>('#route-code');if(code)code.value=o.code;const name=host.querySelector<HTMLInputElement>('#route-name');if(name)name.value=o.name;const labor=host.querySelector<HTMLInputElement>('#route-labor');if(labor)labor.value=String(o.laborNormHoursPerUnit);const setup=host.querySelector<HTMLInputElement>('#route-setup-norm');if(setup)setup.value=String(o.setupNormHours);const workers=host.querySelector<HTMLInputElement>('#route-workers');if(workers)workers.value=String(o.workersRequired);const eq=host.querySelector<HTMLSelectElement>('#route-equipment');if(eq)Array.from(eq.options).forEach(opt=>opt.selected=o.requiredEquipmentIds.includes(opt.value));window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}));
    host.querySelector<HTMLButtonElement>('#route-save')?.addEventListener('click',async()=>{try{const routeId=value('route-route'),workCenterId=value('route-work-center'),qualificationId=value('route-qualification')||null,labor=Number(value('route-labor')),setupNorm=Number(value('route-setup-norm')),workers=Number(value('route-workers'));const operation:NormalizedRouteOperationInput={id:value('route-id'),productId:'',routeId,sequence:Number(value('route-sequence')),code:value('route-code'),name:value('route-name'),workCenter:'',workCenterId,requiredQualification:undefined,requiredQualificationId:qualificationId,requiredEquipmentIds:multiValues('route-equipment'),laborNormHoursPerUnit:labor,setupNormHours:setupNorm,workersRequired:workers,setupMinutes:0,runMinutesPerUnit:0,active:true};if(!operation.id||!routeId||!workCenterId||!operation.code||!operation.name||!Number.isInteger(operation.sequence)||operation.sequence<=0||!Number.isFinite(labor)||!Number.isFinite(setupNorm)||labor<0||setupNorm<0||(labor<=0&&setupNorm<=0)||!Number.isInteger(workers)||workers<=0)throw new Error('Заполните маршрут, участок, операцию и нормы в н-ч');await rpc.saveNormalized(operation);await load();}catch(e){window.alert(e instanceof Error?e.message:'Не удалось сохранить операцию');}});
    host.querySelectorAll<HTMLButtonElement>('[data-remove-route]').forEach(b=>b.addEventListener('click',async()=>{const id=b.dataset.removeRoute??'';if(!id||!window.confirm(`Удалить операцию ${id}?`))return;try{await rpc.remove(id);await load();}catch(e){window.alert(e instanceof Error?e.message:'Не удалось удалить операцию');}}));
  }
  try{await load();}catch(e){host.innerHTML=`<div class="panel-head"><div><h2>Технологические маршруты</h2><div class="subtle" style="color:#b91c1c">${esc(e instanceof Error?e.message:'Не удалось загрузить маршруты')}</div></div></div>`;}
}
