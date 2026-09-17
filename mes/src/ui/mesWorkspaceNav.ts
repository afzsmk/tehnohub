import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';
import './mesWorkspaceNav.css';

type NavItem=[string,string,string];
const MAP:Record<string,NavItem[]>= {
  OPERATOR:[
    ['Работа','.production-entry-page','Производство'],
    ['Простой','.operator-downtime-page','Производство'],
    ['ОТК','.quality-page','Контроль'],
    ['События','.event-journal-page','Контроль']
  ],
  MASTER:[
    ['Обзор','.mes-dashboard-page','Обзор'],['Заявки','.production-requests-page','Планирование'],['Заказы','.orders-page','Планирование'],['Gantt','.dispatch-gantt-page','Планирование'],
    ['Работа','.production-entry-page','Производство'],['Оборудование','.equipment-operations-page','Ресурсы'],
    ['Операционный контур','.operational-workflow-page','Контроль'],['ОТК','.quality-page','Контроль'],
    ['НСИ','.nsi-admin-page','Администрирование'],['Импорт','.import-center-page','Администрирование']
  ],
  DISPATCHER:[
    ['Обзор','.mes-dashboard-page','Обзор'],['Заявки','.production-requests-page','Планирование'],['Заказы','.orders-page','Планирование'],['Gantt','.dispatch-gantt-page','Планирование'],
    ['Работа','.production-entry-page','Производство'],['Оборудование','.equipment-operations-page','Ресурсы'],['ОТК','.quality-page','Контроль']
  ],
  PLANNER:[
    ['Обзор','.mes-dashboard-page','Обзор'],['Заявки','.production-requests-page','Планирование'],['Заказы','.orders-page','Планирование'],['Gantt','.dispatch-gantt-page','Планирование'],
    ['НСИ','.nsi-admin-page','Администрирование'],['Импорт','.import-center-page','Администрирование']
  ],
  QUALITY:[['ОТК','.quality-page','Контроль'],['Операционный контур','.operational-workflow-page','Контроль'],['События','.event-journal-page','Контроль']],
  MAINTENANCE:[['Оборудование','.equipment-operations-page','Ресурсы'],['Простой','.operator-downtime-page','Ресурсы'],['События','.event-journal-page','Контроль']],
  ANALYST:[['Обзор','.mes-dashboard-page','Обзор'],['События','.event-journal-page','Контроль']],
  PRODUCTION_MANAGER:[
    ['Обзор','.mes-dashboard-page','Обзор'],['Заявки','.production-requests-page','Планирование'],['Заказы','.orders-page','Планирование'],['Gantt','.dispatch-gantt-page','Планирование'],
    ['Работа','.production-entry-page','Производство'],['Оборудование','.equipment-operations-page','Ресурсы'],['Операционный контур','.operational-workflow-page','Контроль'],['ОТК','.quality-page','Контроль'],
    ['НСИ','.nsi-admin-page','Администрирование'],['Импорт','.import-center-page','Администрирование'],['События','.event-journal-page','Контроль']
  ],
  ADMIN:[
    ['Обзор','.mes-dashboard-page','Обзор'],['Заявки','.production-requests-page','Планирование'],['Заказы','.orders-page','Планирование'],['Gantt','.dispatch-gantt-page','Планирование'],
    ['Работа','.production-entry-page','Производство'],['Оборудование','.equipment-operations-page','Ресурсы'],['Операционный контур','.operational-workflow-page','Контроль'],['ОТК','.quality-page','Контроль'],['События','.event-journal-page','Контроль'],
    ['НСИ','.nsi-admin-page','Администрирование'],['Импорт','.import-center-page','Администрирование'],['Пользователи','.mes-user-admin-page','Администрирование'],['Контроль','.integrity-page','Администрирование']
  ]
};

export async function mountMesWorkspaceNav(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client,{hydrateSnapshot:false});
  const role=auth.identity?.role;if(!role)return;
  const items=(MAP[role]??MAP.PRODUCTION_MANAGER).filter(([,selector])=>root.querySelector(selector));
  if(!items.length)return;
  const nav=document.createElement('nav');
  nav.className='mes-workspace-nav';
  nav.setAttribute('aria-label','Рабочие места MES');
  nav.innerHTML=`<div class="mes-workspace-brand"><strong>MES</strong><span>${role}</span></div><div class="mes-workspace-nav-groups">${[...new Set(items.map(([, ,group])=>group))].map(group=>`<section class="mes-nav-group"><div class="mes-nav-group-title">${group}</div>${items.filter(([, ,itemGroup])=>itemGroup===group).map(([label,selector])=>`<button class="mes-nav-link" data-target="${selector}">${label}</button>`).join('')}</section>`).join('')}</div>`;
  root.prepend(nav);

  const targets=items.map(([,selector])=>root.querySelector<HTMLElement>(selector)).filter((element):element is HTMLElement=>Boolean(element));
  for(const element of targets){element.setAttribute('data-mes-page','');element.hidden=true;}

  const buttons=[...nav.querySelectorAll<HTMLButtonElement>('[data-target]')];
  const activate=(selector:string)=>{
    for(const element of targets) element.hidden=!element.matches(selector);
    for(const button of buttons){const active=button.dataset.target===selector;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');}
    sessionStorage.setItem(`mes-active-page-${role}`,selector);
  };
  const saved=sessionStorage.getItem(`mes-active-page-${role}`);
  const initial=(saved&&items.some(([,selector])=>selector===saved)?saved:items[0][1]);
  buttons.forEach(button=>button.addEventListener('click',()=>activate(button.dataset.target??items[0][1])));
  activate(initial);
}
