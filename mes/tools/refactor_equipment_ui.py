from pathlib import Path
import re

path = Path('mes/src/ui/nsiAdminPage.ts')
text = path.read_text(encoding='utf-8')

# Remove all manual capability-editor helpers. Keep the underlying data model intact.
text, count = re.subn(
    r"\n  const capabilityLabel=.*?\n  const equipmentPicker=",
    "\n  const equipmentPicker=",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'capability helper block not found: {count}')

old = """+`<div class=\"nsi-admin-field full\"><label>Технологические возможности</label>${equipmentCapabilityPicker(equipmentCapabilitiesSelected(x?.id??'',x?.capabilities??[]))}<small style=\"color:var(--muted,#667085)\">Отметьте операции маршрутов, которые это оборудование может выполнять.</small></div>`"""
new = """+`<div class=\"nsi-admin-field full\"><small style=\"color:var(--muted,#667085)\">Конкретное оборудование для производственной операции указывается в карточке операции маршрута.</small></div>`"""
if old not in text:
    raise SystemExit('equipment form capability editor not found')
text = text.replace(old, new, 1)

old = """<small>${esc(e.capabilities.join(', ')||'Возможности не заполнены')}</small>"""
if old not in text:
    raise SystemExit('equipment picker capability label not found')
text = text.replace(old, '', 1)

old = """capabilities:Array.from(f.getAll('equipment_capability_code')).map(String)"""
new = """capabilities:data.equipment.find(e=>e.id===id)?.capabilities??[]"""
if old not in text:
    raise SystemExit('equipment save capability field not found')
text = text.replace(old, new, 1)

old = """<label>Оборудование</label>${equipmentPicker(wcId,equipmentIds)}<small style=\"color:var(--muted,#667085)\">Выберите конкретные единицы, которые допустимы для этой операции. Можно выбрать несколько.</small>"""
new = """<label>Оборудование для операции</label>${equipmentPicker(wcId,equipmentIds)}<small style=\"color:var(--muted,#667085)\">Выберите конкретные единицы оборудования, которые должны быть назначены этой операции. Можно выбрать несколько.</small>"""
if old not in text:
    raise SystemExit('route operation equipment text not found')
text = text.replace(old, new, 1)

old = """    if(tab==='equipment'){headers='<th>Код</th><th>Оборудование</th><th>Рабочий центр</th><th>Возможности</th><th>Статус</th><th>Действия</th>';rows=data.equipment.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc(data.workCenters.find(w=>w.id===x.work_center_id)?.name??x.work_center)}</td><td>${esc((data.equipmentCapabilities.filter(c=>c.equipment_id===x.id).map(c=>capabilityLabel(c.operation_code)).join(', '))||x.capabilities.join(', ')||'—')}</td><td>${status(x.active)}</td>${action('equipment',x.id)}</tr>`).join('');}\n"""
new = """    if(tab==='equipment'){headers='<th>Код</th><th>Оборудование</th><th>Рабочий центр</th><th>Статус</th><th>Действия</th>';rows=data.equipment.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc(data.workCenters.find(w=>w.id===x.work_center_id)?.name??x.work_center)}</td><td>${status(x.active)}</td>${action('equipment',x.id)}</tr>`).join('');}\n"""
if old not in text:
    raise SystemExit('equipment table block not found')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('MES equipment UI refactor applied')
