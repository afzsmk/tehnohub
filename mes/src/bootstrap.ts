import { getMesAuthState } from './integration/auth';
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
import { getMesSupabaseClient } from './services/supabase';

const supabase = getMesSupabaseClient();

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function reportRemoteFailure(error: unknown): void {
  const message = formatError(error);
  const app = document.querySelector<HTMLDivElement>('#app') ?? document.body;
  let box = document.getElementById('mes-bootstrap-error');
  if (!box) {
    box = document.createElement('div');
    box.id = 'mes-bootstrap-error';
    box.style.cssText = 'margin:24px auto;padding:20px;max-width:900px;border:1px solid #e5a6a6;border-radius:10px;background:#fff5f5;color:#7a1f1f;font-family:system-ui,sans-serif;';
    app.prepend(box);
  }
  box.innerHTML = `<b>MES не удалось полностью загрузить.</b><div style="margin-top:8px;white-space:pre-wrap">${message.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c] ?? c))}</div><div style="margin-top:12px;color:#555">Остальные разделы не будут скрываться из-за ошибки одного модуля.</div>`;
  console.error('MES bootstrap failure', error);
}

async function safeMount(name: string, mount: () => void | Promise<void>): Promise<void> {
  try {
    await mount();
  } catch (error) {
    console.error(`MES module failed: ${name}`, error);
    reportRemoteFailure(new Error(`${name}: ${formatError(error)}`));
  }
}

void import('./main').then(async () => {
  if (!supabase) return;
  mountMesRegistration(supabase);
  const auth = await getMesAuthState(supabase, { hydrateSnapshot: false });
  if (!auth.identity) return;

  const app = document.querySelector<HTMLDivElement>('#app') ?? document.body;
  await safeMount('MES Dashboard', () => mountMesDashboardPage(app, supabase));

  const workspace = document.createElement('div');
  workspace.id = 'mes-persistent-workspaces';
  workspace.style.maxWidth = '1440px';
  workspace.style.margin = '0 auto';
  workspace.style.padding = '0 16px 48px';
  document.body.appendChild(workspace);

  await safeMount('Operational Workflow', () => mountOperationalWorkflowPage(workspace, supabase));
  await safeMount('Production Entry', () => mountProductionEntryPage(workspace, supabase));
  await safeMount('Operator Downtime', () => mountOperatorDowntimePage(workspace, supabase));
  await safeMount('Equipment Operations', () => mountEquipmentOperationsPage(workspace, supabase));
  await safeMount('Dispatch Gantt', () => mountDispatchGanttPage(workspace, supabase));
  await safeMount('Orders', () => mountOrdersPage(workspace, supabase));
  await safeMount('Production Requests', () => mountProductionRequestsPage(workspace, supabase));
  await safeMount('Quality', () => mountQualityPage(workspace, supabase));
  await safeMount('Event Journal', () => mountEventJournalPage(workspace, supabase));
  await safeMount('Integrity', () => mountIntegrityPage(workspace, supabase));
  await safeMount('Workflow Monitor', () => mountWorkflowMonitorPage(workspace, supabase));
  await safeMount('NSI', () => mountNsiAdminPage(workspace, supabase));
  await safeMount('Import Center', () => mountImportCenterPage(workspace, supabase));
  await safeMount('MES User Administration', () => mountMesUserAdminPage(workspace, supabase));
  await safeMount('Workspace Navigation', () => mountMesWorkspaceNav(workspace, supabase));
}).catch(reportRemoteFailure);
