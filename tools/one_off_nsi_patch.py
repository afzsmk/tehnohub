from pathlib import Path

UI = Path('mes/src/ui/nsiAdminPage.ts')
RPC = Path('mes/src/integration/mesMasterDataRpc.ts')


def replace_once(path: Path, old: str, new: str):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly 1 match, got {count}: {old[:120]}')
    path.write_text(text.replace(old, new), encoding='utf-8')

replace_once(
    RPC,
    ".from('shift_definitions').select('id,name,start_minute,duration_minutes,active').order('start_minute')",
    ".from('shift_definitions').select('id,name,start_minute,duration_minutes,active').order('id')",
)

replace_once(
    UI,
    "const timeToMins=(s:string)=>{const [h,m]=s.split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:0;};",
    "const timeToMins=(s:string)=>{const [h,m]=s.split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:0;};\nconst parseDecimal=(v:unknown)=>{const n=Number(String(v??'').trim().replace(',','.'));return Number.isFinite(n)?n:0;};",
)

replace_once(
    UI,
    "  const equipmentPicker=(workCenterId:string,selected:string[])=>{",
    r'''  const capabilityLabel=(code:string)=>{const op=data.routeOperations.find(r=>r.code===code);return op?`${op.code} — ${op.name}`:code;};
  const equipmentCapabilitiesSelected=(equipmentId:string,fallback:string[])=>{const normalized=data.equipmentCapabilities.filter(c=>c.equipment_id===equipmentId).map(c=>c.operation_code);return normalized.length?normalized:fallback;};
  const capabilityOptions=()=>{const seen=new Map<string,string>();for(const op of data.routeOperations.filter(r=>r.active).slice().sort((a,b)=>a.code.localeCompare(b.code,'ru'))){if(!seen.has(op.code))seen.set(op.code,`${op.code} — ${op.name}`);}return Array.from(seen.entries());};
  const equipmentCapabilityPicker=(selected:string[])=>{const opts=capabilityOptions();if(!opts.length)return `<div class="nsi-equipment-picker" data-capability-picker="1"><div class="nsi-equipment-picker-empty">Сначала создайте операции маршрутов — они будут доступны как технологические возможности оборудования.</div></div>`;return `<div class="nsi-equipment-picker" data-capability-picker="1">${opts.map(([code,label])=>`<label class="nsi-equipment-option"><input type="checkbox" name="equipment_capability_code" value="${esc(code)}" ${selected.includes(code)?'checked':''}><span>${esc(label)}</span></label>`).join('')}</div>`;};
  const equipmentPicker=(workCenterId:string,selected:string[])=>{''',
)

replace_once(
    UI,
    "<td>${esc(data.routes.find(r=>r.id===x.route_id)?.code??'—')}</td><td>${esc(data.workCenters.find(w=>w.id===x.work_center_id)?.name??x.work_center)}</td>",
    "<td>${esc(data.routes.find(r=>r.id===x.route_id)?.name??'—')}</td><td>${esc(data.workCenters.find(w=>w.id===x.work_center_id)?.name??x.work_center)}</td>",
)

old_equipment_table = r'''<td>${esc(x.capabilities.join(', ')||'—')}</td><td>${status(x.active)}</td>${action('equipment',x.id)}</tr>`).join('');}'''
new_equipment_table = r'''<td>${esc((data.equipmentCapabilities.filter(c=>c.equipment_id===x.id).map(c=>capabilityLabel(c.operation_code)).join(', '))||x.capabilities.join(', ')||'—')}</td><td>${status(x.active)}</td>${action('equipment',x.id)}</tr>`).join('');}'''
replace_once(UI, old_equipment_table, new_equipment_table)

old_equipment_form = r'''field('capabilities','Возможности','text',(x?.capabilities??[]).join(', '),'','placeholder="например: лазерная резка, алюминий, лист до 2 мм"')+check('active','Активно',x?.active!==false)'''
new_equipment_form = r'''`<div class="nsi-admin-field full"><label>Технологические возможности</label>${equipmentCapabilityPicker(equipmentCapabilitiesSelected(x?.id??'',x?.capabilities??[]))}<small style="color:var(--muted,#667085)">Отметьте операции маршрутов, которые это оборудование может выполнять.</small></div>`+check('active','Активно',x?.active!==false)'''
replace_once(UI, old_equipment_form, new_equipment_form)

replace_once(
    UI,
    "capabilities:String(f.get('capabilities')||'').split(',').map(x=>x.trim()).filter(Boolean)",
    "capabilities:Array.from(f.getAll('equipment_capability_code')).map(String)",
)
replace_once(UI, "setup_norm_hours:Number(f.get('setup_norm_hours'))", "setup_norm_hours:parseDecimal(f.get('setup_norm_hours'))")
replace_once(UI, "labor_norm_hours_per_unit:Number(f.get('labor_norm_hours_per_unit'))", "labor_norm_hours_per_unit:parseDecimal(f.get('labor_norm_hours_per_unit'))")

print('NSI patch applied successfully')
