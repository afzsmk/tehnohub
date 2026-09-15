import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';

const ROLES = ['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER','OPERATOR','MAINTENANCE','QUALITY','ANALYST'] as const;

type UserRow = { user_id:string; email:string|null; mes_role:string|null; employee_id:string|null; employee_active:boolean|null };
type EmployeeRow = { id:string; personnel_no:string; name:string; active:boolean };

const esc=(v:unknown)=>String(v??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]??ch));

export async function mountMesUserAdminPage(root:HTMLElement,client:SupabaseClient):Promise<void>{
  const auth=await getMesAuthState(client);
  if(auth.identity?.role!=='ADMIN') return;
  const host=document.createElement('section');host.className='panel mes-user-admin-page';root.querySelector('main.page')?.appendChild(host);

  async function load():Promise<void>{
    const [{data:users,error:userError},{data:employees,error:employeeError}]=await Promise.all([
      client.rpc('mes_admin_list_users'),
      client.from('employees').select('id,personnel_no,name,active').order('name')
    ]);
    if(userError) throw userError;
    if(employeeError) throw employeeError;
    const userRows=(users??[]) as UserRow[];
    const employeeRows=(employees??[]) as EmployeeRow[];
    host.innerHTML=`<div class="panel-head"><div><h2>Доступ к MES</h2><div class="subtle">Пользователи MES · роли · привязка оператора к сотруднику</div></div><button class="primary" id="user-admin-refresh">Обновить</button></div><div style="padding:0 18px 12px"><div class="subtle">Пользователь регистрируется на экране входа MES. После регистрации он появляется здесь без роли. ADMIN назначает роль и, для ОПЕРАТОРА, сотрудника. После нового входа или обновления сессии пользователь получает свой рабочий контур.</div></div><div class="table-wrap"><table><thead><tr><th>Email</th><th>MES роль</th><th>Сотрудник</th><th>Действие</th></tr></thead><tbody>${userRows.map(u=>{
      const role=u.mes_role??'';
      const employeeOptions=[`<option value="">— не привязан —</option>`,...employeeRows.filter(e=>e.active||e.id===u.employee_id).map(e=>`<option value="${esc(e.id)}" ${e.id===u.employee_id?'selected':''}>${esc(e.personnel_no)} · ${esc(e.name)}</option>`)].join('');
      const roleOptions=[`<option value="">— не задана —</option>`,...ROLES.map(r=>`<option value="${r}" ${r===role?'selected':''}>${r}</option>`)].join('');
      return `<tr><td><strong>${esc(u.email??u.user_id)}</strong><div class="subtle" style="font-size:10px">${esc(u.user_id)}</div></td><td><select data-role="${esc(u.user_id)}">${roleOptions}</select></td><td><select data-employee="${esc(u.user_id)}">${employeeOptions}</select></td><td><button class="tiny primary" data-save="${esc(u.user_id)}">Сохранить</button></td></tr>`;
    }).join('')||'<tr><td colspan="4">Нет зарегистрированных пользователей</td></tr>'}</tbody></table></div>`;
    host.querySelector<HTMLButtonElement>('#user-admin-refresh')?.addEventListener('click',()=>void load());
    host.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(btn=>btn.addEventListener('click',async()=>{
      const userId=btn.dataset.save??'';
      const role=(host.querySelector<HTMLSelectElement>(`[data-role="${CSS.escape(userId)}"]`)?.value??'').trim();
      const employeeId=(host.querySelector<HTMLSelectElement>(`[data-employee="${CSS.escape(userId)}"]`)?.value??'').trim()||null;
      if(!role){window.alert('Сначала выберите MES роль.');return;}
      if(role==='OPERATOR'&&!employeeId){window.alert('Для ОПЕРАТОР необходимо выбрать сотрудника.');return;}
      btn.disabled=true;
      try{
        const {error}=await client.rpc('mes_admin_set_user_role',{p_user_id:userId,p_role:role,p_employee_id:employeeId});
        if(error) throw error;
        window.alert('Доступ сохранён. Пользователю нужно войти заново или обновить сессию, чтобы получить новую MES роль.');
        await load();
      }catch(error){window.alert(error instanceof Error?error.message:String(error));btn.disabled=false;}
    }));
  }

  try{await load();}catch(error){host.innerHTML=`<div class="panel-head"><div><h2>Доступ к MES</h2><div class="subtle">Не удалось загрузить пользователей</div></div></div><div style="padding:18px;color:#b91c1c">${esc(error instanceof Error?error.message:String(error))}</div>`;}
}
