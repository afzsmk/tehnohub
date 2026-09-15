import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import './mesWorkspaceNav.css';
const MAP: Record<string,[string,string][]> = {
 OPERATOR:[['Работа','.production-entry-page'],['Простой','.operator-downtime-page'],['ОТК','.quality-page'],['События','.event-journal-page']],
 MASTER:[['Обзор','.mes-dashboard-page'],['Работа','.production-entry-page'],['Заказы','.orders-page'],['Gantt','.dispatch-gantt-page'],['Оборудование','.equipment-operations-page'],['НСИ','.nsi-workspace-page'],['Импорт','.import-center-page'],['ОТК','.quality-page']],
 DISPATCHER:[['Обзор','.mes-dashboard-page'],['Заказы','.orders-page'],['Gantt','.dispatch-gantt-page'],['Работа','.production-entry-page'],['Оборудование','.equipment-operations-page'],['НСИ','.nsi-workspace-page'],['Импорт','.import-center-page'],['ОТК','.quality-page']],
 PLANNER:[['Обзор','.mes-dashboard-page'],['Заказы','.orders-page'],['Gantt','.dispatch-gantt-page'],['НСИ','.nsi-workspace-page'],['Импорт','.import-center-page']],
 QUALITY:[['ОТК','.quality-page'],['Контур','.operational-workflow-page'],['События','.event-journal-page']],
 MAINTENANCE:[['Оборудование','.equipment-operations-page'],['Простой','.operator-downtime-page'],['События','.event-journal-page']],
 ANALYST:[['Dashboard','.mes-dashboard-page'],['План / факт','.plan-fact-panel'],['События','.event-journal-page']],
 PRODUCTION_MANAGER:[['Обзор','.mes-dashboard-page'],['Заказы','.orders-page'],['Gantt','.dispatch-gantt-page'],['Работа','.production-entry-page'],['Оборудование','.equipment-operations-page'],['НСИ','.nsi-workspace-page'],['Импорт','.import-center-page'],['ОТК','.quality-page'],['События','.event-journal-page']],
 ADMIN:[['Обзор','.mes-dashboard-page'],['Заказы','.orders-page'],['Gantt','.dispatch-gantt-page'],['Работа','.production-entry-page'],['Оборудование','.equipment-operations-page'],['НСИ','.nsi-workspace-page'],['Импорт','.import-center-page'],['ОТК','.quality-page'],['События','.event-journal-page'],['Пользователи','.mes-user-admin-page'],['Контроль','.integrity-page']]
};
export async function mountMesWorkspaceNav(root:HTMLElement,client:SupabaseClient):Promise<void>{
 const auth=await getMesAuthState(client);const role=auth.identity?.role;if(!role)return;
 const items=(MAP[role]??MAP.PRODUCTION_MANAGER).filter(([,selector])=>root.querySelector(selector));if(!items.length)return;
 const nav=document.createElement('nav');nav.className='mes-workspace-nav';nav.setAttribute('aria-label','Рабочие места MES');
 nav.innerHTML=`<strong>MES · ${role}</strong><div class="mes-workspace-nav-links">${items.map(([label,selector])=>`<button class="mes-nav-link" data-target="${selector}">${label}</button>`).join('')}</div>`;
 root.prepend(nav);nav.querySelectorAll<HTMLButtonElement>('[data-target]').forEach(button=>button.addEventListener('click',()=>{root.querySelector(button.dataset.target??'')?.scrollIntoView({behavior:'smooth',block:'start'});}));
}
