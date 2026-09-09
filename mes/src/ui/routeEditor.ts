import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product, RouteOperation } from '../types';
import { SupabaseMesRouteRpc } from '../integration/mesRouteRpc';

interface DbRow {
  id: string;
  product_id: string;
  sequence: number;
  code: string;
  name: string;
  work_center: string;
  required_qualification: number | null;
  required_equipment_ids: unknown;
  setup_minutes: number;
  run_minutes_per_unit: number;
  active: boolean;
}

function rows(value: unknown): DbRow[] {
  return Array.isArray(value) ? value.filter((row): row is DbRow => Boolean(row) && typeof row === 'object') : [];
}

function map(row: DbRow): RouteOperation & { productId: string; active: boolean } {
  return {
    id: row.id,
    productId: row.product_id,
    sequence: Number(row.sequence),
    code: row.code,
    name: row.name,
    workCenter: row.work_center,
    requiredQualification: row.required_qualification == null ? undefined : Number(row.required_qualification),
    requiredEquipmentIds: Array.isArray(row.required_equipment_ids) ? row.required_equipment_ids.filter((value): value is string => typeof value === 'string') : [],
    setupMinutes: Number(row.setup_minutes),
    runMinutesPerUnit: Number(row.run_minutes_per_unit),
    active: row.active
  };
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

export async function mountRouteEditor(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const host = document.createElement('section');
  host.className = 'panel';
  host.innerHTML = '<div class="panel-head"><div><h2>Технологические маршруты</h2><div class="subtle">Операции хранятся в MES master-data и применяются при диспетчеризации.</div></div><span class="status-pill">Загрузка…</span></div>';
  root.querySelector('main.page')?.appendChild(host);

  const rpc = new SupabaseMesRouteRpc(client);
  async function load(): Promise<void> {
    const [{ data: productsData, error: productsError }, { data: routeData, error: routeError }] = await Promise.all([
      client.from('products').select('id,code,name,unit').order('code'),
      client.from('route_operations').select('*').order('product_id').order('sequence')
    ]);
    if (productsError) throw productsError;
    if (routeError) throw routeError;
    const products = (Array.isArray(productsData) ? productsData : []) as Product[];
    const operations = rows(routeData).map(map);
    const byProduct = new Map(products.map(product => [product.id, product]));

    host.innerHTML = `<div class="panel-head"><div><h2>Технологические маршруты</h2><div class="subtle">${operations.length} операций для ${products.length} продуктов</div></div></div>
      <div class="route-editor-form">
        <input id="route-id" placeholder="ID операции" required>
        <select id="route-product">${products.map(product => `<option value="${esc(product.id)}">${esc(product.code)} · ${esc(product.name)}</option>`).join('')}</select>
        <input id="route-sequence" type="number" min="1" placeholder="№" value="10" required>
        <input id="route-code" placeholder="Код" required>
        <input id="route-name" placeholder="Операция" required>
        <input id="route-work-center" placeholder="Участок" required>
        <input id="route-qualification" type="number" min="0" placeholder="Разряд">
        <input id="route-equipment" placeholder="Оборудование через запятую">
        <input id="route-setup" type="number" min="0" placeholder="Наладка, мин" value="0">
        <input id="route-run" type="number" min="0" step="0.001" placeholder="мин/ед." value="0">
        <button id="route-save" class="primary" type="button">Сохранить операцию</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Продукт</th><th>№</th><th>Код</th><th>Операция</th><th>Участок</th><th>Разряд</th><th>Оборудование</th><th>Наладка</th><th>мин/ед.</th><th></th></tr></thead><tbody>
      ${operations.map(operation => {
        const product = byProduct.get(operation.productId);
        return `<tr><td>${esc(product?.code ?? operation.productId)}</td><td>${operation.sequence}</td><td>${esc(operation.code)}</td><td>${esc(operation.name)}</td><td>${esc(operation.workCenter)}</td><td>${operation.requiredQualification ?? '—'}</td><td>${esc(operation.requiredEquipmentIds?.join(', ') ?? '')}</td><td>${operation.setupMinutes}</td><td>${operation.runMinutesPerUnit}</td><td><button class="tiny danger-button" data-remove-route="${esc(operation.id)}">Удалить</button></td></tr>`;
      }).join('') || '<tr><td colspan="10">Маршруты не настроены</td></tr>'}</tbody></table></div>`;

    host.querySelector<HTMLButtonElement>('#route-save')?.addEventListener('click', async () => {
      const value = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)?.value.trim() ?? '';
      try {
        const operation: RouteOperation & { productId: string } = {
          id: value('route-id'),
          productId: host.querySelector<HTMLSelectElement>('#route-product')?.value ?? '',
          sequence: Number(value('route-sequence')),
          code: value('route-code'),
          name: value('route-name'),
          workCenter: value('route-work-center'),
          requiredQualification: value('route-qualification') ? Number(value('route-qualification')) : undefined,
          requiredEquipmentIds: value('route-equipment').split(',').map(item => item.trim()).filter(Boolean),
          setupMinutes: Number(value('route-setup')),
          runMinutesPerUnit: Number(value('route-run'))
        };
        if (!operation.id || !operation.productId || !operation.code || !operation.name || !operation.workCenter || !Number.isFinite(operation.sequence) || !Number.isFinite(operation.runMinutesPerUnit)) throw new Error('Заполните обязательные поля операции');
        await rpc.save(operation);
        await load();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Не удалось сохранить операцию');
      }
    });

    host.querySelectorAll<HTMLButtonElement>('[data-remove-route]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.removeRoute ?? '';
      if (!id || !window.confirm(`Удалить операцию ${id}?`)) return;
      try {
        await rpc.remove(id);
        await load();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Не удалось удалить операцию');
      }
    }));
  }

  try {
    await load();
  } catch (error) {
    host.innerHTML = `<div class="panel-head"><div><h2>Технологические маршруты</h2><div class="subtle">${esc(error instanceof Error ? error.message : 'Не удалось загрузить маршруты')}</div></div><span class="status-pill status-danger">Ошибка</span></div>`;
  }
}
