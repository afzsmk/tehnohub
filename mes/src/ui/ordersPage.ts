import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductionOrder } from '../types';
import { getMesAuthState } from '../integration/auth';
import { SupabaseMesOrderRpc } from '../integration/mesOrderRpc';

const PLANNING_ROLES = ['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'];
const RELEASE_ROLES = ['ADMIN','PRODUCTION_MANAGER','DISPATCHER','MASTER'];

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch] ?? ch)); }
function statusLabel(value: string): string { return ({IMPORTED:'Импортирован',PLANNED:'Запланирован',RELEASED:'Выпущен',IN_EXECUTION:'В работе',PARTIALLY_COMPLETED:'Частично выполнен',COMPLETED:'Завершён',BLOCKED:'Заблокирован',CANCELLED:'Отменён'} as Record<string,string>)[value] ?? value; }
function statusClass(value: string): string { return ['COMPLETED'].includes(value) ? 'status-ok' : ['BLOCKED','CANCELLED'].includes(value) ? 'status-danger' : ['IN_EXECUTION','PARTIALLY_COMPLETED'].includes(value) ? 'status-warning' : 'status-neutral'; }

export async function mountOrdersPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  const role = auth.identity?.role;
  if (!role) return;
  const canPlan = PLANNING_ROLES.includes(role);
  const canRelease = RELEASE_ROLES.includes(role);
  const query = client.from('production_orders').select('id,external_id,number,product_id,quantity,completed_quantity,due_at,priority,status').order('due_at',{ascending:true});
  const { data, error } = await query;
  if (error) throw error;
  const orders = (Array.isArray(data) ? data : []) as Array<Omit<ProductionOrder,'route'> & { external_id:string|null }>;
  const host=document.createElement('section');
  host.className='panel orders-page';
  host.innerHTML=`<div class="panel-head"><div><h2>Производственные заказы</h2><div class="subtle">Оперативное управление статусом и запуском заказов · роль ${esc(role)}</div></div><button class="primary" id="orders-refresh">Обновить</button></div>
    <div class="orders-toolbar"><span>${orders.length} заказов</span><span>Запланированных: ${orders.filter(o=>o.status==='PLANNED').length}</span><span>В работе: ${orders.filter(o=>['IN_EXECUTION','PARTIALLY_COMPLETED'].includes(o.status)).length}</span></div>
    <div class="orders-table-wrap"><table><thead><tr><th>Заказ</th><th>Количество</th><th>Выполнено</th><th>Срок</th><th>Приоритет</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${orders.map(o=>{
      const action=[] as string[];
      if(canPlan && ['IMPORTED','BLOCKED'].includes(o.status)) action.push(`<button class="tiny" data-plan-order="${esc(o.id)}">Спланировать</button>`);
      if(canRelease && o.status==='PLANNED') action.push(`<button class="tiny" data-release-order="${esc(o.id)}">Выпустить</button>`);
      if(canRelease && ['RELEASED','IN_EXECUTION'].includes(o.status)) action.push(`<button class="tiny" data-block-order="${esc(o.id)}">Заблокировать</button>`);
      const pct=o.quantity>0?((Number(o.completed_quantity)/Number(o.quantity))*100).toFixed(1):'0.0';
      return `<tr><td><strong>${esc(o.number)}</strong><div class="subtle">${esc(o.external_id??'')} · ${esc(o.id)}</div></td><td>${Number(o.quantity)}</td><td>${Number(o.completed_quantity)} <span class="subtle">(${pct}%)</span></td><td>${new Date(o.due_at).toLocaleDateString('ru-RU')}</td><td>${esc(o.priority)}</td><td><span class="status-pill ${statusClass(o.status)}">${statusLabel(o.status)}</span></td><td>${action.join(' ')||'—'}</td></tr>`;
    }).join('')||'<tr><td colspan="7">Заказов нет</td></tr>'}</tbody></table></div>`;
  root.appendChild(host);
  const rpc=new SupabaseMesOrderRpc(client);
  host.querySelector('#orders-refresh')?.addEventListener('click',()=>window.location.reload());
  host.querySelectorAll<HTMLButtonElement>('[data-plan-order]').forEach(button=>button.addEventListener('click',async()=>{try{const r=await rpc.planOrder(button.dataset.planOrder??'');window.alert(`Создано заданий: ${r.createdTasks}; существовало: ${r.existingTasks}`);window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось спланировать заказ');}}));
  const change=async(button:HTMLButtonElement,next:ProductionOrder['status'])=>{try{await rpc.changeStatus(button.dataset.orderId??'',next);window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось изменить статус заказа');}};
  host.querySelectorAll<HTMLButtonElement>('[data-release-order]').forEach(button=>{button.dataset.orderId=button.dataset.releaseOrder??'';button.addEventListener('click',()=>void change(button,'RELEASED'));});
  host.querySelectorAll<HTMLButtonElement>('[data-block-order]').forEach(button=>{button.dataset.orderId=button.dataset.blockOrder??'';button.addEventListener('click',()=>void change(button,'BLOCKED'));});
}
