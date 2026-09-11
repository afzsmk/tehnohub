import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { SupabaseMesMasterDataRpc, BootstrapPayload, BootstrapValidation } from '../integration/mesMasterDataRpc';
import { getMesAuthState } from '../integration/auth';

const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]??ch));
const text=(v:unknown)=>String(v??'').trim();
const num=(v:unknown)=>Number(String(v??'').replace(',','.'));
const bool=(v:unknown, fallback=true)=>{const s=text(v).toLowerCase();if(!s)return fallback;return ['true','1','да','yes','work','рабочий','active'].includes(s);};
function sheetRows(book:XLSX.WorkBook,name:string):Record<string,unknown>[] {const sheet=book.Sheets[name];return sheet?XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:'',raw:true}):[];}
function timeToMinute(v:unknown):number {if(v instanceof Date)return v.getHours()*60+v.getMinutes();const s=text(v);const m=s.match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):num(v)||0;}
function dateText(v:unknown):string {if(v instanceof Date)return v.toISOString().slice(0,10);const s=text(v);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);}
function asList(v:unknown):string[]{return text(v).split(/[;,]/).map(s=>s.trim()).filter(Boolean);}

function parseWorkbook(buffer:ArrayBuffer):{payload:BootstrapPayload;summary:Record<string,number>;warnings:string[]} {
  const book=XLSX.read(buffer,{type:'array',cellDates:true});
  const warnings:string[]=[];
  const products=sheetRows(book,'01_Products').filter(r=>text(r.external_id||r.code||r.id));
  const professions=sheetRows(book,'02_Professions').filter(r=>text(r.external_id||r.code||r.id));
  const qualifications=sheetRows(book,'03_Qualifications').filter(r=>text(r.external_id||r.code||r.id));
  const employees=sheetRows(book,'04_Employees').filter(r=>text(r.external_id||r.personnel_no||r.id));
  const employeeQualifications=sheetRows(book,'05_Employee_Qualifications').filter(r=>text(r.employee_external_id)&&text(r.qualification_external_id));
  const workCenters=sheetRows(book,'06_Work_Centers').filter(r=>text(r.external_id||r.code));
  const equipment=sheetRows(book,'07_Equipment').filter(r=>text(r.external_id||r.code));
  const capabilities=sheetRows(book,'08_Equipment_Capabilities').filter(r=>text(r.equipment_external_id)&&text(r.route_operation_code));
  const brigades=sheetRows(book,'09_Brigades').filter(r=>text(r.external_id||r.code));
  const shifts=sheetRows(book,'10_Shifts').filter(r=>text(r.external_id||r.code));
  const calendar=sheetRows(book,'11_Calendars').filter(r=>text(r.date));
  const routes=sheetRows(book,'12_Routes').filter(r=>text(r.external_id||r.code));
  const ops=sheetRows(book,'13_Route_Operations').filter(r=>text(r.operation_external_id));
  const downtimeReasons=sheetRows(book,'14_Downtime_Reasons').filter(r=>text(r.code));
  const scrapReasons=sheetRows(book,'15_Scrap_Reasons').filter(r=>text(r.code));
  const employeeSchedules=sheetRows(book,'16_Employee_Schedules').filter(r=>text(r.employee_external_id)&&text(r.date));

  const productRef=(ref:string)=>{const direct=products.find(p=>text(p.external_id||p.code)===ref);return direct?text(direct.external_id||direct.code):ref;};
  const equipmentRef=(ref:string)=>{const direct=equipment.find(e=>text(e.external_id||e.code)===ref);return direct?text(direct.external_id||direct.code):ref;};
  const professionRef=(ref:string)=>{const direct=professions.find(p=>text(p.external_id||p.code)===ref);return direct?text(direct.external_id||direct.code):ref;};
  const qualificationRef=(ref:string)=>{const direct=qualifications.find(p=>text(p.external_id||p.code)===ref);return direct?text(direct.external_id||direct.code):ref;};
  const brigadeRef=(ref:string)=>{const direct=brigades.find(p=>text(p.external_id||p.code)===ref);return direct?text(direct.external_id||direct.code):ref;};
  const shiftRef=(ref:string)=>{const direct=shifts.find(p=>text(p.external_id||p.code)===ref);return direct?text(direct.external_id||direct.code):ref;};

  const payload:BootstrapPayload={
    products:products.map(r=>({id:text(r.external_id||r.code),code:text(r.code||r.external_id),name:text(r.name),unit:text(r.unit),external_id:text(r.external_id)||null})),
    professions:professions.map(r=>({id:text(r.external_id||r.code),code:text(r.code||r.external_id),name:text(r.name),external_id:text(r.external_id)||null,description:text(r.description)||null,active:bool(r.status,true)})),
    qualification_levels:qualifications.map(r=>({id:text(r.external_id||r.code),code:text(r.code||r.external_id),name:text(r.name),level:num(r.level)||0,external_id:text(r.external_id)||null,description:text(r.description)||null,active:bool(r.status,true)})),
    brigades:brigades.map(r=>({id:text(r.external_id||r.code),code:text(r.code||r.external_id),name:text(r.name),external_id:text(r.external_id)||null,description:text(r.description)||null,active:bool(r.status,true)})),
    employees:employees.map(r=>({id:text(r.external_id||r.personnel_no),personnel_no:text(r.personnel_no||r.external_id),name:[text(r.last_name),text(r.first_name),text(r.middle_name)].filter(Boolean).join(' ')||text(r.name),profession:text(r.profession_external_id||r.profession),profession_id:text(r.profession_external_id)?professionRef(text(r.profession_external_id)):null,brigade_id:text(r.brigade_external_id)?brigadeRef(text(r.brigade_external_id)):null,qualification_id:text(r.qualification_external_id)?qualificationRef(text(r.qualification_external_id)):null,qualification_level:num(r.qualification_level)||0,active:bool(r.status,true)})),
    employee_qualifications:employeeQualifications.map(r=>({employee_id:text(r.employee_external_id),qualification_id:qualificationRef(text(r.qualification_external_id)),valid_from:dateText(r.valid_from)||null,valid_to:dateText(r.valid_to)||null,is_primary:bool(r.is_primary,false),notes:text(r.notes)||null})),
    equipment:equipment.map(r=>({id:text(r.external_id||r.code),code:text(r.code||r.external_id),name:text(r.name),work_center:text(r.work_center_external_id||r.work_center),capabilities:asList(r.capabilities),active:bool(r.status,true)})),
    shifts:shifts.map(r=>({id:text(r.external_id||r.code),name:text(r.name||r.code),start_minute:timeToMinute(r.start_time),duration_minutes:num(r.duration_hours)*60||((timeToMinute(r.end_time)-timeToMinute(r.start_time)+1440)%1440||1440),active:bool(r.status,true)})),
    route_operations:ops.map(r=>({id:text(r.operation_external_id),product_id:productRef(text(r.product_external_id||r.product_id||r.route_external_id).replace(/^ROUTE-/,'PROD-')),route_id:text(r.route_external_id)||undefined,sequence:num(r.sequence_no),code:text(r.operation_code||r.operation_external_id),name:text(r.operation_name),work_center:text(r.work_center_external_id||r.work_center),required_qualification:text(r.qualification_external_id)?num(r.qualification_external_id)||0:undefined,required_equipment_ids:asList(r.equipment_external_id||r.required_equipment_ids).map(equipmentRef),setup_norm_hours:num(r.setup_norm_hours||r.setup_hours),labor_norm_hours_per_unit:num(r.labor_norm_hours_per_unit||r.labor_norm),workers_required:num(r.workers_required)||1,active:bool(r.status,true)})),
    calendar_days:calendar.map(r=>({date:dateText(r.date),is_working:bool(r.is_working,false),shift_ids:asList(r.shift_external_id).map(shiftRef)})).filter(r=>r.date),
    employee_schedules:employeeSchedules.map(r=>({employee_id:text(r.employee_external_id),date:dateText(r.date),shift_ids:asList(r.shift_external_id).map(shiftRef),status:text(r.status)||'WORK'})).filter(r=>r.employee_id&&r.date),
    downtime_reasons:downtimeReasons.map(r=>({code:text(r.code),name:text(r.name),category:text(r.category)||'OTHER',is_planned:bool(r.is_planned,false),description:text(r.description)||null,active:bool(r.status,true)})),
    scrap_reasons:scrapReasons.map(r=>({code:text(r.code),name:text(r.name),category:text(r.category)||'OTHER',description:text(r.description)||null,active:bool(r.status,true)}))
  };
  if(workCenters.length)warnings.push(`Лист 06_Work_Centers: обнаружено ${workCenters.length} строк. Сейчас рабочие центры импортируются в справочник equipment/work_center; отдельный справочник work_centers будет нормализован следующим этапом.`);
  if(routes.length)warnings.push(`Лист 12_Routes: обнаружено ${routes.length} маршрутов. Текущая MES runtime-модель хранит route operations по product_id; route/version identity будет вынесена в отдельную сущность следующим этапом.`);
  if(capabilities.length)warnings.push(`Лист 08_Equipment_Capabilities: обнаружено ${capabilities.length} строк. Сейчас capabilities используются как часть оборудования/route eligibility; отдельная сущность capability будет нормализована следующим этапом.`);
  if(!employeeSchedules.length)warnings.push('Лист 16_Employee_Schedules не найден или пуст — персональные смены останутся по общему календарю.');
  const summary={products:payload.products?.length??0,professions:payload.professions?.length??0,qualification_levels:payload.qualification_levels?.length??0,brigades:payload.brigades?.length??0,employees:payload.employees?.length??0,employee_qualifications:payload.employee_qualifications?.length??0,equipment:payload.equipment?.length??0,shifts:payload.shifts?.length??0,route_operations:payload.route_operations?.length??0,calendar_days:payload.calendar_days?.length??0,employee_schedules:payload.employee_schedules?.length??0,downtime_reasons:payload.downtime_reasons?.length??0,scrap_reasons:payload.scrap_reasons?.length??0};
  return{payload,summary,warnings};
}

function validationHtml(v:BootstrapValidation):string{
  const errors=v.errors.length?`<div style="margin-top:10px;color:#991b1b"><strong>Ошибки (${v.errors.length}):</strong><br>${v.errors.slice(0,25).map(esc).join('<br>')}${v.errors.length>25?'<br>…':''}</div>`:'<div style="margin-top:10px;color:#166534"><strong>Ошибок не найдено.</strong></div>';
  const warnings=v.warnings.length?`<div style="margin-top:10px;color:#92400e"><strong>Предупреждения (${v.warnings.length}):</strong><br>${v.warnings.slice(0,25).map(esc).join('<br>')}</div>`:'';
  return errors+warnings;
}

export async function mountImportCenterPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client);if(!auth.identity)return;
  const host=document.createElement('section');host.className='panel';root.querySelector('main.page')?.appendChild(host);
  host.innerHTML=`<div class="panel-head"><div><h2>Центр импорта НСИ</h2><div class="subtle">Excel → разбор → серверная проверка → подтверждение → атомарная загрузка</div></div><button class="primary" id="mes-import-refresh">Обновить историю</button></div><div style="padding:16px 18px;border-bottom:1px solid #e2e8f0"><input id="mes-import-file" type="file" accept=".xlsx,.xls"/><div id="mes-import-preview" class="subtle" style="margin-top:10px">Выберите заполненный Excel-шаблон.</div></div><div id="mes-import-actions" style="padding:14px 18px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #e2e8f0"></div><div style="padding:14px 18px"><div class="section-title">История импорта</div><div class="table-wrap"><table><thead><tr><th>Время</th><th>Источник</th><th>Статус</th><th>Результат</th></tr></thead><tbody id="mes-import-history"><tr><td colspan="4">Загрузка…</td></tr></tbody></table></div></div>`;
  const preview=host.querySelector<HTMLDivElement>('#mes-import-preview')!;const actions=host.querySelector<HTMLDivElement>('#mes-import-actions')!;const history=host.querySelector<HTMLTableSectionElement>('#mes-import-history')!;const rpc=new SupabaseMesMasterDataRpc(client);
  async function loadHistory(){const{data,error}=await client.from('mes_master_import_runs').select('id,actor_id,started_at,finished_at,status,source_name,counts').order('started_at',{ascending:false}).limit(12);if(error){history.innerHTML=`<tr><td colspan="4">${esc(error.message)}</td></tr>`;return;}history.innerHTML=(data??[]).map((r:any)=>`<tr><td>${new Date(r.started_at).toLocaleString('ru-RU')}</td><td>${esc(r.source_name||'—')}</td><td><span class="status-pill ${r.status==='COMPLETED'?'status-ok':r.status==='FAILED'?'status-danger':'status-warning'}">${esc(r.status)}</span></td><td><code>${esc(JSON.stringify(r.counts||{}))}</code></td></tr>`).join('')||'<tr><td colspan="4">История пока пуста</td></tr>';}
  let parsed:{payload:BootstrapPayload;summary:Record<string,number>;warnings:string[]}|null=null;let validated=false;
  host.querySelector<HTMLButtonElement>('#mes-import-refresh')!.addEventListener('click',()=>void loadHistory());
  host.querySelector<HTMLInputElement>('#mes-import-file')!.addEventListener('change',async()=>{
    const file=host.querySelector<HTMLInputElement>('#mes-import-file')!.files?.[0];if(!file)return;parsed=null;validated=false;actions.innerHTML='';
    try{
      parsed=parseWorkbook(await file.arrayBuffer());
      const s=parsed.summary;
      preview.innerHTML=`<strong>${esc(file.name)}</strong><br>Продукты: ${s.products} · Профессии: ${s.professions} · Квалификации: ${s.qualification_levels} · Бригады: ${s.brigades} · Сотрудники: ${s.employees} · Квалификации сотрудников: ${s.employee_qualifications} · Оборудование: ${s.equipment} · Смены: ${s.shifts} · Операции: ${s.route_operations} · Календарь: ${s.calendar_days} · Смены сотрудников: ${s.employee_schedules} · Причины простоев: ${s.downtime_reasons} · Причины брака: ${s.scrap_reasons}${parsed.warnings.length?`<br><br><strong>Предупреждения Excel:</strong><br>${parsed.warnings.map(esc).join('<br>')}`:''}<div id="mes-import-validation" style="margin-top:8px">Серверная проверка…</div>`;
      const validation=await rpc.validateBootstrap(parsed.payload);validated=validation.valid;host.querySelector<HTMLDivElement>('#mes-import-validation')!.innerHTML=validationHtml(validation);actions.innerHTML=validation.valid?`<button class="primary" id="mes-import-confirm">Подтвердить и импортировать</button>`:'<span class="status-pill status-danger">Импорт заблокирован</span>';
      if(validation.valid)host.querySelector<HTMLButtonElement>('#mes-import-confirm')!.addEventListener('click',async()=>{if(!parsed||!validated)return;const btn=host.querySelector<HTMLButtonElement>('#mes-import-confirm')!;btn.disabled=true;try{const result=await rpc.importBootstrap(file.name,parsed.payload);preview.innerHTML+=`<div style="margin-top:10px;color:#166534"><strong>Импорт завершён.</strong> Run: ${esc(result.runId)}<br>${esc(JSON.stringify(result.counts))}</div>`;actions.innerHTML='<span class="status-pill status-ok">COMPLETED</span>';await loadHistory();}catch(e){preview.innerHTML+=`<div style="margin-top:10px;color:#991b1b"><strong>Импорт не выполнен:</strong> ${esc(e instanceof Error?e.message:'ошибка')}</div>`;btn.disabled=false;}});
    }catch(e){preview.innerHTML=`<span style="color:#b91c1c">Не удалось прочитать/проверить Excel: ${esc(e instanceof Error?e.message:'ошибка')}</span>`;actions.innerHTML='';}
  });
  await loadHistory();
}
