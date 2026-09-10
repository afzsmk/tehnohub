import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { SupabaseMesMasterDataRpc, BootstrapPayload } from '../integration/mesMasterDataRpc';
import { getMesAuthState } from '../integration/auth';

const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]??ch));
const text=(v:unknown)=>String(v??'').trim();
const num=(v:unknown)=>Number(String(v??'').replace(',','.'));
const bool=(v:unknown, fallback=true)=>{const s=text(v).toLowerCase(); if(!s)return fallback; return ['true','1','да','yes','work','рабочий','active'].includes(s);};
function sheetRows(book:XLSX.WorkBook,name:string):Record<string,unknown>[] { const sheet=book.Sheets[name]; return sheet ? XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:''}) : []; }
function timeToMinute(v:unknown):number { const s=text(v); const m=s.match(/^(\d{1,2}):(\d{2})$/); return m?Number(m[1])*60+Number(m[2]):num(v)||0; }

function parseWorkbook(buffer:ArrayBuffer):{payload:BootstrapPayload; summary:Record<string,number>; warnings:string[]} {
  const book=XLSX.read(buffer,{type:'array',cellDates:true});
  const warnings:string[]=[];
  const products=sheetRows(book,'01_Products').filter(r=>text(r.external_id||r.code||r.id));
  const employees=sheetRows(book,'04_Employees').filter(r=>text(r.external_id||r.personnel_no));
  const equipment=sheetRows(book,'07_Equipment').filter(r=>text(r.external_id||r.code));
  const shifts=sheetRows(book,'10_Shifts').filter(r=>text(r.external_id||r.code));
  const ops=sheetRows(book,'13_Route_Operations').filter(r=>text(r.operation_external_id));
  const calendar=sheetRows(book,'11_Calendars').filter(r=>text(r.date));
  const schedules=sheetRows(book,'05_Employee_Qualifications');
  const productIdByRef=new Map(products.map(r=>[text(r.external_id||r.code),text(r.external_id||r.code)]));
  const equipmentIdByRef=new Map(equipment.map(r=>[text(r.external_id||r.code),text(r.external_id||r.code)]));
  const payload:BootstrapPayload={
    products:products.map(r=>({id:text(r.external_id||r.code),code:text(r.code||r.external_id),name:text(r.name),unit:text(r.unit),external_id:text(r.external_id)||null})),
    employees:employees.map(r=>({id:text(r.external_id||r.personnel_no),personnel_no:text(r.personnel_no||r.external_id),name:[text(r.last_name),text(r.first_name),text(r.middle_name)].filter(Boolean).join(' '),profession:text(r.profession_external_id||r.profession),qualification_level:num(r.qualification_level)||0,active:bool(r.status,true)})),
    equipment:equipment.map(r=>({id:text(r.external_id||r.code),code:text(r.code||r.external_id),name:text(r.name),work_center:text(r.work_center_external_id||r.work_center),capabilities:text(r.capabilities).split(/[;,]/).map(s=>s.trim()).filter(Boolean),active:bool(r.status,true)})),
    shifts:shifts.map(r=>({id:text(r.external_id||r.code),name:text(r.name||r.code),start_minute:timeToMinute(r.start_time),duration_minutes:num(r.duration_hours)*60||((timeToMinute(r.end_time)-timeToMinute(r.start_time)+1440)%1440||1440),active:bool(r.status,true)})),
    route_operations:ops.map(r=>{const ref=text(r.route_external_id); const productId=productIdByRef.get(ref.replace(/^ROUTE-/,'PROD-'))||productIdByRef.get(text(r.product_external_id))||ref; const equipmentRefs=text(r.equipment_external_id||r.required_equipment_ids).split(/[;,]/).map(s=>equipmentIdByRef.get(s.trim())||s.trim()).filter(Boolean); return {id:text(r.operation_external_id),product_id:productId,sequence:num(r.sequence_no),code:text(r.operation_code||r.operation_external_id),name:text(r.operation_name),work_center:text(r.work_center_external_id||r.work_center),required_qualification:text(r.qualification_external_id)?undefined:num(r.qualification_external_id)||0,required_equipment_ids:equipmentRefs,setup_norm_hours:num(r.setup_norm_hours||r.setup_hours),labor_norm_hours_per_unit:num(r.labor_norm_hours_per_unit||r.labor_norm),workers_required:num(r.workers_required)||1,active:true};}),
    calendar_days:calendar.map(r=>({date:text(r.date),is_working:bool(r.is_working,false),shift_ids:text(r.shift_external_id)?[text(r.shift_external_id)]:[]})),
    employee_schedules:[]
  };
  for(const r of schedules){ if(text(r.employee_external_id)&&text(r.qualification_external_id)) warnings.push(`Лист 05_Employee_Qualifications: employee=${text(r.employee_external_id)} qualification=${text(r.qualification_external_id)} не загружается в текущую схему employee_qualifications; базовый уровень берётся из Employees.`); }
  const summary={products:payload.products?.length??0,employees:payload.employees?.length??0,equipment:payload.equipment?.length??0,shifts:payload.shifts?.length??0,route_operations:payload.route_operations?.length??0,calendar_days:payload.calendar_days?.length??0};
  return {payload,summary,warnings};
}

export async function mountImportCenterPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client); if(!auth.identity)return;
  const host=document.createElement('section'); host.className='panel'; root.querySelector('main.page')?.appendChild(host);
  host.innerHTML=`<div class="panel-head"><div><h2>Центр импорта НСИ</h2><div class="subtle">Bootstrap Excel → проверка → подтверждение → атомарная загрузка в MES</div></div><span class="status-pill status-neutral">Готов</span></div><div style="padding:16px 18px;border-bottom:1px solid #e2e8f0"><input id="mes-import-file" type="file" accept=".xlsx,.xls"/><div id="mes-import-preview" class="subtle" style="margin-top:10px">Выберите заполненный Excel-шаблон.</div></div><div id="mes-import-actions" style="padding:14px 18px;display:flex;gap:10px"></div>`;
  let parsed:{payload:BootstrapPayload;summary:Record<string,number>;warnings:string[]}|null=null;
  const preview=host.querySelector<HTMLDivElement>('#mes-import-preview')!; const actions=host.querySelector<HTMLDivElement>('#mes-import-actions')!;
  host.querySelector<HTMLInputElement>('#mes-import-file')!.addEventListener('change',async()=>{
    const file=host.querySelector<HTMLInputElement>('#mes-import-file')!.files?.[0]; if(!file)return;
    try{parsed=parseWorkbook(await file.arrayBuffer()); preview.innerHTML=`<strong>${esc(file.name)}</strong><br>Продукты: ${parsed.summary.products} · Сотрудники: ${parsed.summary.employees} · Оборудование: ${parsed.summary.equipment} · Смены: ${parsed.summary.shifts} · Операции: ${parsed.summary.route_operations} · Календарь: ${parsed.summary.calendar_days}${parsed.warnings.length?`<br><br><strong>Предупреждения:</strong><br>${parsed.warnings.map(esc).join('<br>')}`:''}`; actions.innerHTML=`<button class="primary" id="mes-import-confirm">Импортировать в MES</button>`; actions.querySelector<HTMLButtonElement>('#mes-import-confirm')!.addEventListener('click',async()=>{ if(!parsed)return; const btn=actions.querySelector<HTMLButtonElement>('#mes-import-confirm')!; btn.disabled=true; try{const result=await new SupabaseMesMasterDataRpc(client).importBootstrap(file.name,parsed.payload); preview.innerHTML=`<strong>Импорт завершён.</strong> Run: ${esc(result.runId)}<br>${esc(JSON.stringify(result.counts))}`; actions.innerHTML='<span class="status-pill status-ok">COMPLETED</span>'; }catch(e){ preview.innerHTML=`<span style="color:#b91c1c">${esc(e instanceof Error?e.message:'Импорт не выполнен')}</span>`; btn.disabled=false; }}); }catch(e){ parsed=null; preview.innerHTML=`<span style="color:#b91c1c">Не удалось прочитать Excel: ${esc(e instanceof Error?e.message:'ошибка')}</span>`; actions.innerHTML=''; }
  });
}
