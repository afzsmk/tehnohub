import type { SupabaseClient } from '@supabase/supabase-js';
import { getMesAuthState } from '../integration/auth';

interface IntegrityViolation {
  entityId: string;
  entityType: string;
  code: string;
  message: string;
}
interface IntegrityReport {
  ok: boolean;
  checkedAt: string;
  violationCount: number;
  violations: IntegrityViolation[];
}

const LABELS: Record<string, string> = {
  TASK_OVER_PLAN: 'Факт задания больше плана',
  ORDER_OVER_PLAN: 'Факт заказа больше плана',
  ORDER_FACT_MISMATCH: 'Расхождение факта заказа',
  COMPLETED_WITHOUT_QUALITY: 'Завершение без ОТК',
  INACTIVE_EMPLOYEE_ASSIGNMENT: 'Неактивный сотрудник',
  INACTIVE_EQUIPMENT_ASSIGNMENT: 'Неактивное оборудование'
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[ch] ?? ch));
}

export async function mountIntegrityPage(root: HTMLElement, client: SupabaseClient): Promise<void> {
  const auth = await getMesAuthState(client);
  if (!auth.identity) return;

  const allowed = ['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER','ANALYST','QUALITY','MAINTENANCE'];
  if (!allowed.includes(auth.identity.role)) return;

  const host = document.createElement('section');
  host.className = 'panel integrity-page';
  host.innerHTML = `<div class="panel-head"><div><h2>Контроль целостности MES</h2><div class="subtle">Проверка производственного контура без изменения данных</div></div><button class="tiny" id="integrity-run">Проверить</button></div><div id="integrity-result"><div class="subtle">Проверка ещё не запускалась</div></div>`;
  root.appendChild(host);

  const resultHost = host.querySelector<HTMLDivElement>('#integrity-result');
  const button = host.querySelector<HTMLButtonElement>('#integrity-run');
  const run = async (): Promise<void> => {
    button!.disabled = true;
    resultHost!.innerHTML = '<div class="subtle">Проверка выполняется…</div>';
    try {
      const { data, error } = await client.rpc('mes_check_operational_integrity');
      if (error) throw error;
      const report = data as IntegrityReport;
      const violations = Array.isArray(report.violations) ? report.violations : [];
      resultHost!.innerHTML = `<div class="quality-kpi-grid"><div class="kpi-card"><div class="subtle">Состояние</div><strong>${report.ok ? 'OK' : 'Есть нарушения'}</strong></div><div class="kpi-card"><div class="subtle">Нарушения</div><strong>${report.violationCount}</strong></div><div class="kpi-card"><div class="subtle">Проверено</div><strong>${esc(new Date(report.checkedAt).toLocaleString('ru-RU'))}</strong></div></div>${violations.length ? `<div class="execution-table-wrap"><table><thead><tr><th>Тип</th><th>Сущность</th><th>ID</th><th>Описание</th></tr></thead><tbody>${violations.map(item => `<tr><td><strong>${esc(LABELS[item.code] ?? item.code)}</strong><div class="subtle">${esc(item.code)}</div></td><td>${esc(item.entityType)}</td><td>${esc(item.entityId)}</td><td>${esc(item.message)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="subtle">Критических расхождений не обнаружено.</div>'}`;
    } catch (error) {
      resultHost!.innerHTML = `<div class="subtle">Ошибка проверки: ${esc(error instanceof Error ? error.message : 'неизвестная ошибка')}</div>`;
    } finally {
      button!.disabled = false;
    }
  };

  button?.addEventListener('click', () => { void run(); });
  await run();
}
