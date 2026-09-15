import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesMasterDataRpc } from '../integration/mesMasterDataRpc';
import './nsiWorkspacePage.css';

type Id = string;

interface Product { id: Id; code: string; name: string; unit: string; external_id: string | null; }
interface Employee { id: Id; personnel_no: string; name: string; profession: string; profession_id: Id | null; brigade_id: Id | null; qualification_id: Id | null; qualification_level: number; active: boolean; }
interface Equipment { id: Id; code: string; name: string; work_center: string | null; work_center_id: Id | null; capabilities: string[]; active: boolean; }
interface WorkCenter { id: Id; code: string; name: string; site_code: string | null; description: string | null; active: boolean; }
interface Route { id: Id; product_id: Id; code: string; name: string; version: number; active: boolean; valid_from: string | null; valid_to: string | null; }
interface Operation { id: Id; route_id: Id | null; product_id: Id; sequence: number; code: string; name: string; work_center: string | null; work_center_id: Id | null; required_qualification: number | null; required_qualification_id: Id | null; required_equipment_ids: Id[]; labor_norm_hours_per_unit: number; setup_norm_hours: number; workers_required: number; active: boolean; }
interface Profession { id: Id; code: string; name: string; active: boolean; }
interface Qualification { id: Id; code: string; name: string; level: number; active: boolean; }
interface Brigade { id: Id; code: string; name: string; active: boolean; }

interface NsiData {
  products: Product[];
  employees: Employee[];
  equipment: Equipment[];
  workCenters: WorkCenter[];
  routes: Route[];
  operations: Operation[];
  professions: Profession[];
  qualifications: Qualification[];
  brigades: Brigade[];
}

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>\"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
}[ch] ?? ch));

const status = (value: boolean): string =>
  `<span class="nsi-status ${value ? 'ok' : 'off'}">${value ? 'Активен' : 'Неактивен'}</span>`;

const createId = (): string => crypto.randomUUID();

export async function mountNsiWorkspacePage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;

  const host = document.createElement('section');
  host.className = 'panel nsi-workspace-page';
  root.querySelector('main.page')?.appendChild(host);

  const rpc = new SupabaseMesMasterDataRpc(client);
  const state = { tab: 'overview', q: '', open: null as string | null };

  async function load(): Promise<void> {
    const [products, employees, equipment, workCenters, routes, operations, professions, qualifications, brigades] = await Promise.all([
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

    for (const result of [products, employees, equipment, workCenters, routes, operations, professions, qualifications, brigades]) {
      if (result.error) throw result.error;
    }

    const data: NsiData = {
      products: (products.data ?? []) as Product[],
      employees: (employees.data ?? []) as Employee[],
      equipment: (equipment.data ?? []) as Equipment[],
      workCenters: (workCenters.data ?? []) as WorkCenter[],
      routes: (routes.data ?? []) as Route[],
      operations: (operations.data ?? []) as Operation[],
      professions: (professions.data ?? []) as Profession[],
      qualifications: (qualifications.data ?? []) as Qualification[],
      brigades: (brigades.data ?? []) as Brigade[]
    };

    const productMap = new Map<Id, Product>(data.products.map(item => [item.id, item]));
    const workCenterMap = new Map<Id, WorkCenter>(data.workCenters.map(item => [item.id, item]));
    const qualificationMap = new Map<Id, Qualification>(data.qualifications.map(item => [item.id, item]));
    const professionMap = new Map<Id, Profession>(data.professions.map(item => [item.id, item]));
    const brigadeMap = new Map<Id, Brigade>(data.brigades.map(item => [item.id, item]));
    const q = state.q.toLowerCase();
    const matches = (...values: unknown[]): boolean => !q || values.join(' ').toLowerCase().includes(q);
    const routeOperations = (routeId: Id): Operation[] =>
      data.operations.filter(item => item.route_id === routeId).sort((a, b) => a.sequence - b.sequence);

    const tabs: Array<[string, string]> = [
      ['overview', 'Обзор'],
      ['products', 'Номенклатура'],
      ['routes', 'Технологии'],
      ['equipment', 'Оборудование'],
      ['employees', 'Персонал'],
      ['organization', 'Организация'],
      ['references', 'Справочники']
    ];

    let body = '';

    if (state.tab === 'overview') {
      body = `
        <div class="nsi-kpis">
          <button data-tab="products"><strong>${data.products.length}</strong><span>Номенклатура</span></button>
          <button data-tab="routes"><strong>${data.routes.length}</strong><span>Маршруты</span></button>
          <button data-tab="equipment"><strong>${data.equipment.length}</strong><span>Оборудование</span></button>
          <button data-tab="employees"><strong>${data.employees.length}</strong><span>Сотрудники</span></button>
        </div>
        <div class="nsi-grid-two">
          <div class="nsi-card">
            <div class="nsi-card-title">Готовность НСИ</div>
            ${[
              ['Номенклатура', data.products.length],
              ['Рабочие центры', data.workCenters.length],
              ['Оборудование', data.equipment.length],
              ['Персонал', data.employees.length],
              ['Маршруты', data.routes.length]
            ].map(([label, count]) => `<div class="nsi-check">${count ? '✓' : '○'} ${label} <span>${count}</span></div>`).join('')}
            <div class="nsi-note">Production НСИ не подменяется демо-данными. Реальные данные заводятся в MES или через Import Center.</div>
          </div>
          <div class="nsi-card">
            <div class="nsi-card-title">Источники</div>
            <div class="nsi-owner"><b>ERP / Workforce</b><span>Номенклатура</span></div>
            <div class="nsi-owner"><b>MES</b><span>Маршруты, оборудование, рабочие центры, операционный персонал</span></div>
            <div class="nsi-owner"><b>ADMIN</b><span>Доступ и контроль полноты</span></div>
          </div>
        </div>`;
    }

    if (state.tab === 'products') {
      const rows = data.products.filter(item => matches(item.code, item.name, item.unit)).map(item => `
        <tr data-open="products:${esc(item.id)}">
          <td><b>${esc(item.code)}</b></td><td>${esc(item.name)}</td><td>${esc(item.unit)}</td>
          <td><span class="nsi-source">ERP / Workforce</span></td><td>${esc(item.external_id ?? '—')}</td>
        </tr>`).join('');
      body = `<div class="nsi-section-head"><div><div class="nsi-section-title">Номенклатура</div><div class="subtle">Источник ERP / Workforce · только просмотр в MES</div></div><span class="nsi-readonly">Import Center</span></div>
        <div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Наименование</th><th>Ед.</th><th>Источник</th><th>External ID</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Нет данных</td></tr>'}</tbody></table></div>`;
    }

    if (state.tab === 'routes') {
      const rows = data.routes.filter(item => matches(item.code, item.name, productMap.get(item.product_id)?.code)).map(item => `
        <tr data-open="routes:${esc(item.id)}">
          <td><b>${esc(item.code)}</b></td><td>${esc(productMap.get(item.product_id)?.code ?? item.product_id)}</td>
          <td>${esc(item.name)}</td><td>v${item.version}</td><td>${routeOperations(item.id).length}</td><td>${status(item.active)}</td>
        </tr>`).join('');
      body = `<div class="nsi-section-head"><div><div class="nsi-section-title">Технологии</div><div class="subtle">Маршрутная карта: маршрут → операции → ресурсы</div></div><button class="primary" id="new-route">Новый маршрут</button></div>
        <div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Продукт</th><th>Название</th><th>Версия</th><th>Операций</th><th>Статус</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Маршруты не настроены</td></tr>'}</tbody></table></div>`;
    }

    if (state.tab === 'equipment') {
      const rows = data.equipment.filter(item => matches(item.code, item.name, item.work_center, workCenterMap.get(item.work_center_id ?? '')?.name)).map(item => `
        <tr data-open="equipment:${esc(item.id)}">
          <td><b>${esc(item.code)}</b></td><td>${esc(item.name)}</td>
          <td>${esc(workCenterMap.get(item.work_center_id ?? '')?.code ?? item.work_center ?? '—')}</td>
          <td>${esc(item.capabilities.join(', ') || '—')}</td><td>${status(item.active)}</td>
        </tr>`).join('');
      body = `<div class="nsi-section-head"><div><div class="nsi-section-title">Оборудование</div><div class="subtle">Рабочий центр, возможности и статус</div></div><button class="primary" id="new-equipment">Новое оборудование</button></div>
        <div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Оборудование</th><th>Рабочий центр</th><th>Возможности</th><th>Статус</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Оборудование не заведено</td></tr>'}</tbody></table></div>`;
    }

    if (state.tab === 'employees') {
      const rows = data.employees.filter(item => matches(item.personnel_no, item.name, item.profession)).map(item => `
        <tr data-open="employees:${esc(item.id)}">
          <td><b>${esc(item.personnel_no)}</b></td><td>${esc(item.name)}</td>
          <td>${esc(professionMap.get(item.profession_id ?? '')?.name ?? item.profession ?? '—')}</td>
          <td>${esc(qualificationMap.get(item.qualification_id ?? '')?.name ?? String(item.qualification_level ?? '—'))}</td>
          <td>${esc(brigadeMap.get(item.brigade_id ?? '')?.name ?? '—')}</td><td>${status(item.active)}</td>
        </tr>`).join('');
      body = `<div class="nsi-section-head"><div><div class="nsi-section-title">Персонал</div><div class="subtle">Профессия, квалификация и бригада</div></div><button class="primary" id="new-employee">Новый сотрудник</button></div>
        <div class="table-wrap nsi-table"><table><thead><tr><th>Таб. №</th><th>ФИО</th><th>Профессия</th><th>Квалификация</th><th>Бригада</th><th>Статус</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Сотрудники не заведены</td></tr>'}</tbody></table></div>`;
    }

    if (state.tab === 'organization') {
      const rows = data.workCenters.filter(item => matches(item.code, item.name, item.site_code)).map(item => `
        <tr data-open="work_centers:${esc(item.id)}">
          <td><b>${esc(item.code)}</b></td><td>${esc(item.name)}</td><td>${esc(item.site_code ?? '—')}</td>
          <td>${data.equipment.filter(equipment => equipment.work_center_id === item.id).length}</td><td>${status(item.active)}</td>
        </tr>`).join('');
      body = `<div class="nsi-section-head"><div><div class="nsi-section-title">Организация</div><div class="subtle">Рабочие центры и производственная структура</div></div><button class="primary" id="new-wc">Новый рабочий центр</button></div>
        <div class="table-wrap nsi-table"><table><thead><tr><th>Код</th><th>Рабочий центр</th><th>Площадка</th><th>Оборудования</th><th>Статус</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Рабочие центры не заведены</td></tr>'}</tbody></table></div>`;
    }

    if (state.tab === 'references') {
      body = `<div class="nsi-reference-grid">
        <div><b>Профессии</b><span>${data.professions.length}</span></div>
        <div><b>Квалификации</b><span>${data.qualifications.length}</span></div>
        <div><b>Бригады</b><span>${data.brigades.length}</span></div>
        <div><b>Операции маршрутов</b><span>${data.operations.length}</span></div>
      </div>
      <div class="nsi-card"><div class="nsi-card-title">Связанные справочники</div><div class="subtle">Профессии и квалификации используются в карточках персонала; рабочие центры — в оборудовании и маршрутах.</div></div>`;
    }

    let drawer = '';
    if (state.open) {
      const separator = state.open.indexOf(':');
      const type = separator >= 0 ? state.open.slice(0, separator) : '';
      const id = separator >= 0 ? state.open.slice(separator + 1) : '';

      if (type === 'routes') {
        const route = data.routes.find(item => item.id === id);
        if (route) {
          const operationsInRoute = routeOperations(route.id);
          drawer = `<div class="nsi-drawer-backdrop" data-close></div><aside class="nsi-drawer">
            <div class="nsi-drawer-head"><div><span class="nsi-source">MES</span><h3>${esc(route.code)} · ${esc(route.name)}</h3><div class="subtle">${esc(productMap.get(route.product_id)?.name ?? route.product_id)} · v${route.version}</div></div><button class="tiny" data-close>Закрыть</button></div>
            <div class="nsi-operation-chain">${operationsInRoute.map(operation => `<div class="nsi-operation"><div class="nsi-op-no">${operation.sequence}</div><div><b>${esc(operation.code)} · ${esc(operation.name)}</b><div class="subtle">${esc(workCenterMap.get(operation.work_center_id ?? '')?.name ?? operation.work_center ?? '—')} · ${esc(qualificationMap.get(operation.required_qualification_id ?? '')?.name ?? (operation.required_qualification == null ? 'Квалификация не задана' : `разряд ${operation.required_qualification}`))}</div><div class="nsi-op-meta">${operation.labor_norm_hours_per_unit ?? 0} н-ч/ед. · наладка ${operation.setup_norm_hours ?? 0} н-ч · ${operation.workers_required ?? 1} чел.</div></div></div>`).join('') || '<div class="nsi-empty">Операции не настроены.</div>'}</div>
          </aside>`;
        }
      } else {
        const source: Record<string, Array<Product | Equipment | Employee | WorkCenter>> = {
          products: data.products,
          equipment: data.equipment,
          employees: data.employees,
          work_centers: data.workCenters
        };
        const item = source[type]?.find(value => value.id === id);
        if (item) {
          const title = 'code' in item ? item.code : item.personnel_no;
          drawer = `<div class="nsi-drawer-backdrop" data-close></div><aside class="nsi-drawer">
            <div class="nsi-drawer-head"><div><span class="nsi-source">MES</span><h3>${esc(title)} · ${esc(item.name)}</h3></div><button class="tiny" data-close>Закрыть</button></div>
            <div class="nsi-detail-list">${Object.entries(item).filter(([key]) => key !== 'id').slice(0, 8).map(([key, value]) => `<div><span>${esc(key)}</span><b>${esc(Array.isArray(value) ? value.join(', ') : value)}</b></div>`).join('')}</div>
          </aside>`;
        }
      }
    }

    host.innerHTML = `<div class="nsi-head"><div><div class="nsi-title">НСИ</div><div class="subtle">Единое рабочее пространство · ${esc(auth.identity!.role)}</div></div><button class="primary" id="refresh">Обновить</button></div>
      <div class="nsi-nav">${tabs.map(([id, label]) => `<button class="nsi-nav-item ${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="nsi-toolbar"><input id="search" value="${esc(state.q)}" placeholder="Поиск по коду, названию, табельному №…"><span class="subtle">Изменения через серверные RPC</span></div>${body}${drawer}`;

    host.querySelectorAll<HTMLButtonElement>('[data-tab], .nsi-kpis [data-tab]').forEach(button => button.addEventListener('click', () => {
      state.tab = button.dataset.tab ?? 'overview'; state.open = null; void load();
    }));
    host.querySelectorAll<HTMLElement>('[data-open]').forEach(element => element.addEventListener('click', () => {
      state.open = element.dataset.open ?? null; void load();
    }));
    host.querySelectorAll<HTMLElement>('[data-close]').forEach(element => element.addEventListener('click', () => {
      state.open = null; void load();
    }));
    host.querySelector<HTMLButtonElement>('#refresh')?.addEventListener('click', () => void load());
    host.querySelector<HTMLInputElement>('#search')?.addEventListener('input', event => {
      state.q = (event.currentTarget as HTMLInputElement).value; void load();
    });

    host.querySelector<HTMLButtonElement>('#new-wc')?.addEventListener('click', async () => {
      const code = window.prompt('Код рабочего центра'); if (!code) return;
      const name = window.prompt('Наименование'); if (!name) return;
      const site = window.prompt('Площадка') || null;
      try { await rpc.saveWorkCenter({ id: createId(), external_id: null, code, name, site_code: site, description: null, active: true }); await load(); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось сохранить рабочий центр'); }
    });

    host.querySelector<HTMLButtonElement>('#new-equipment')?.addEventListener('click', async () => {
      const code = window.prompt('Код оборудования'); if (!code) return;
      const name = window.prompt('Наименование'); if (!name) return;
      const workCenterId = data.workCenters[0]?.id;
      if (!workCenterId) { window.alert('Сначала заведите рабочий центр'); return; }
      const capabilities = (window.prompt('Возможности через запятую') || '').split(',').map(value => value.trim()).filter(Boolean);
      try { await rpc.saveEquipmentNormalized({ id: createId(), code, name, work_center: '', work_center_id: workCenterId, capabilities, active: true }); await load(); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось сохранить оборудование'); }
    });

    host.querySelector<HTMLButtonElement>('#new-employee')?.addEventListener('click', async () => {
      const personnelNo = window.prompt('Табельный №'); if (!personnelNo) return;
      const name = window.prompt('ФИО'); if (!name) return;
      const profession = window.prompt('Профессия'); if (!profession) return;
      const qualificationLevel = Number(window.prompt('Разряд', '1') || 1);
      try { await rpc.saveEmployee({ id: createId(), personnel_no: personnelNo, name, profession, qualification_level: qualificationLevel, active: true }); await load(); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось сохранить сотрудника'); }
    });

    host.querySelector<HTMLButtonElement>('#new-route')?.addEventListener('click', async () => {
      const product = data.products[0];
      if (!product) { window.alert('Сначала заведите или импортируйте номенклатуру'); return; }
      const code = window.prompt('Код маршрута'); if (!code) return;
      const name = window.prompt('Наименование'); if (!name) return;
      try { await rpc.saveRoute({ id: createId(), external_id: null, product_id: product.id, code, name, version: 1, active: true, valid_from: null, valid_to: null, description: null }); await load(); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Не удалось сохранить маршрут'); }
    });
  }

  try { await load(); }
  catch (error) {
    host.innerHTML = `<div class="nsi-head"><div><div class="nsi-title">НСИ</div><div style="color:#b91c1c">${esc(error instanceof Error ? error.message : 'Не удалось загрузить НСИ')}</div></div></div>`;
  }
}
