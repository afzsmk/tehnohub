import { getMesAuthState, signInMes, signOutMes } from './integration/auth';
import { mountMesRegistration } from './integration/mesRegistration';
import { mountQualityPage } from './ui/qualityPage';
import { mountMesDashboardPage } from './ui/mesDashboardPage';
import { mountOrdersPage } from './ui/ordersPage';
import { mountEventJournalPage } from './ui/eventJournalPage';
import { mountIntegrityPage } from './ui/integrityPage';
import { mountOperationalWorkflowPage } from './ui/operationalWorkflowPage';
import { mountWorkflowMonitorPage } from './ui/workflowMonitorPage';
import { mountProductionEntryPage } from './ui/productionEntryPage';
import { mountOperatorDowntimePage } from './ui/operatorDowntimePage';
import { mountEquipmentOperationsPage } from './ui/equipmentOperationsPage';
import { mountDispatchGanttPage } from './ui/dispatchGanttPage';
import { mountImportCenterPage } from './ui/importCenterPage';
import { mountMesUserAdminPage } from './ui/mesUserAdminPage';
import { mountMesWorkspaceNav } from './ui/mesWorkspaceNav';
import { mountNsiAdminPage } from './ui/nsiAdminPage';
import { mountProductionRequestsPage } from './ui/productionRequestsPage';
import { bindProductionRequestProductLoader } from './ui/productionRequestProductLoader';
import { getMesSupabaseClient } from './services/supabase';
import './mesWorkspace.css';
import './ui/mesWorkspaceNav.css';

const supabase=getMesSupabaseClient();
function getAppElement():HTMLDivElement{const node=document.querySelector<HTMLDivElement>('#app');if(!node)throw new Error('Не найден контейнер приложения');return node;}
const app=getAppElement();
if(supabase)bindProductionRequestProductLoader(supabase);

function esc(value:unknown):string{return String(value??'').replace(/[&<>\\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[c]??c));}
function reportFailure(error:unknown):void{const message=error instanceof Error?error.message:String(error);app.innerHTML=`<div class="panel" style="max-width:900px;margin:48px auto;padding:28px"><h2>MES не удалось загрузить</h2><div class="detail-error">${esc(message)}</div></div>`;console.error('MES bootstrap failure',error);}

function renderLogin():void{
 app.innerHTML=`<div class="panel" style="max-width:720px;margin:64px auto;padding:28px"><div class="subtle" style="margin-bottom:8px">TEHNOHUB · MES</div><h1 style="margin-top:0">Вход в MES</h1><p class="subtle">Авторизованный интерфейс показывает только состояние реального MES.</p><form id="login-form" class="auth-inline"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Пароль" required><button class="primary" type="submit">Войти</button></form></div>`;
 const form=app.querySelector<HTMLFormElement>('#login-form')!;
 form.addEventListener('submit',async event=>{event.preventDefault();if(!supabase)return;const fd=new FormData(form);const button=form.querySelector<HTMLButtonElement>('button[type="submit"]');if(button)button.disabled=true;try{await signInMes(supabase,String(fd.get('email')??''),String(fd.get('password')??''));window.location.reload();}catch(error){window.alert(error instanceof Error?error.message:'Не удалось войти');if(button)button.disabled=false;}});
 if(supabase)mountMesRegistration(supabase);
}

async function safeMount(name:string,mount:()=>void|Promise<void>):Promise<void>{
 try{await mount();}
 catch(error){
   console.error(`MES module failed: ${name}`,error);
   const box=document.createElement('div');
   box.className='detail-error';
   box.style.margin='0 0 12px';
   box.textContent=`${name}: ${error instanceof Error?error.message:String(error)}`;
   app.prepend(box);
 }
}

async function renderWorkspace():Promise<void>{
 if(!supabase){renderLogin();return;}
 const auth=await getMesAuthState(supabase,{hydrateSnapshot:false});
 if(!auth.identity){renderLogin();return;}

 app.innerHTML=`<header class="mes-app-header"><div><h1>MES — оперативное управление производством</h1><div class="subtitle">1–30 дней · заявки · заказы · производство · ресурсы · ОТК</div></div><div class="auth-inline"><span>${esc(auth.identity.role)} · ${esc(auth.user?.email??auth.user?.id??'')}</span><button class="tiny" id="signout">Выйти</button></div></header>`;
 const shell=document.createElement('div');shell.className='mes-workspace-shell';
 const content=document.createElement('main');content.className='mes-workspace-content';
 const loading=document.createElement('div');
 loading.className='panel mes-workspace-loading';
 loading.innerHTML='<div class="panel-body"><strong>Загрузка рабочего пространства MES…</strong><div class="subtle" style="margin-top:4px">Подготавливаем рабочие места и проверяем доступ к данным.</div></div>';
 content.appendChild(loading);
 shell.appendChild(content);app.appendChild(shell);

 document.querySelector<HTMLButtonElement>('#signout')?.addEventListener('click',async()=>{try{await signOutMes(supabase);}catch(error){window.alert(error instanceof Error?error.message:'Не удалось выйти');}});

 const mounts:Array<[string,()=>void|Promise<void>]> = [
   ['MES Dashboard',()=>mountMesDashboardPage(content,supabase)],
   ['Operational Workflow',()=>mountOperationalWorkflowPage(content,supabase)],
   ['Production Entry',()=>mountProductionEntryPage(content,supabase)],
   ...(['OPERATOR','MAINTENANCE'].includes(auth.identity.role)?[['Operator Downtime',()=>mountOperatorDowntimePage(content,supabase)] as [string,()=>void|Promise<void>]]:[]),
   ['Equipment Operations',()=>mountEquipmentOperationsPage(content,supabase)],
   ['Dispatch Gantt',()=>mountDispatchGanttPage(content,supabase)],
   ['Orders',()=>mountOrdersPage(content,supabase)],
   ['Production Requests',()=>mountProductionRequestsPage(content,supabase)],
   ['Quality',()=>mountQualityPage(content,supabase)],
   ['Event Journal',()=>mountEventJournalPage(content,supabase)],
   ['Integrity',()=>mountIntegrityPage(content,supabase)],
   ['Workflow Monitor',()=>mountWorkflowMonitorPage(content,supabase)],
   ['NSI',()=>mountNsiAdminPage(content,supabase)],
   ['Import Center',()=>mountImportCenterPage(content,supabase)],
   ['MES User Administration',()=>mountMesUserAdminPage(content,supabase)]
 ];

 void safeMount('Workspace Navigation',()=>mountMesWorkspaceNav(shell,supabase));

 const runMount=async([name,mount]:[string,()=>void|Promise<void>])=>{
   await safeMount(name,mount);
   if(loading.isConnected && content.querySelector('[class*="-page"]')) loading.remove();
 };

 void Promise.allSettled(mounts.map(runMount)).then(()=>loading.remove());
}

void renderWorkspace().catch(reportFailure);
