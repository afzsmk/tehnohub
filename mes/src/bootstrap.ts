import { getMesAuthState } from './integration/auth';
import { mountRouteEditor } from './ui/routeEditor';
import { mountQualityPage } from './ui/qualityPage';
import { mountMesDashboardPage } from './ui/mesDashboardPage';
import { mountOrdersPage } from './ui/ordersPage';
import { mountEventJournalPage } from './ui/eventJournalPage';
import { mountIntegrityPage } from './ui/integrityPage';
import { mountOperationalWorkflowPage } from './ui/operationalWorkflowPage';
import { mountWorkflowMonitorPage } from './ui/workflowMonitorPage';
import { mountProductionEntryPage } from './ui/productionEntryPage';
import { mountEquipmentOperationsPage } from './ui/equipmentOperationsPage';
import { mountDispatchGanttPage } from './ui/dispatchGanttPage';
import { mountMasterDataPage } from './ui/masterDataPage';
import { mountMasterTopologyPage } from './ui/masterTopologyPage';
import { mountImportCenterPage } from './ui/importCenterPage';
import { subscribeMesRealtime } from './integration/mesRealtime';
import { getMesSupabaseClient } from './services/supabase';

const supabase = getMesSupabaseClient();

function reportRemoteFailure(error: unknown): void {
  window.alert(error instanceof Error ? error.message : 'Серверная операция MES не выполнена');
  window.location.reload();
}

void import('./main').then(async () => {
  if (!supabase) return;
  const auth = await getMesAuthState(supabase);
  if (!auth.identity) return;
  const app = document.querySelector<HTMLDivElement>('#app') ?? document.body;
  await mountMesDashboardPage(app, supabase);
  await mountOperationalWorkflowPage(app, supabase);
  await mountProductionEntryPage(app, supabase);
  await mountEquipmentOperationsPage(app, supabase);
  await mountDispatchGanttPage(app, supabase);
  await mountOrdersPage(app, supabase);
  await mountQualityPage(app, supabase);
  await mountEventJournalPage(app, supabase);
  await mountIntegrityPage(app, supabase);
  await mountWorkflowMonitorPage(app, supabase);
  await mountMasterDataPage(app, supabase);
  await mountMasterTopologyPage(app, supabase);
  await mountImportCenterPage(app, supabase);
  await mountRouteEditor(app, supabase);
  subscribeMesRealtime(supabase, {
    tables: ['production_orders','production_tasks','task_assignments','production_results','quality_inspections','downtime_events','maintenance_orders','equipment_blocks','production_events'],
    onChange: () => window.dispatchEvent(new CustomEvent('mes-realtime-update'))
  });
}).catch(reportRemoteFailure);
