import { createMaintenanceOrder, transitionMaintenance } from '../core/maintenance';
import { MaintenanceOrder, MesState } from '../types';

export interface MaintenancePanelOptions {
  state: MesState;
  actorId: string;
  onChanged: () => void;
  onError: (error: unknown) => void;
}

const fmt = (value: string) => new Date(value).toLocaleString('ru-RU');

function statusLabel(status: MaintenanceOrder['status']): string {
  return ({ PLANNED: 'Запланировано', IN_PROGRESS: 'В работе', DONE: 'Завершено', CANCELLED: 'Отменено' } as const)[status];
}

function typeLabel(type: MaintenanceOrder['type']): string {
  return ({ PM: 'ППР', REPAIR: 'Ремонт', INSPECTION: 'Осмотр' } as const)[type];
}

export function renderMaintenancePanel(options: MaintenancePanelOptions): string {
  const { state } = options;
  const active = state.maintenance.filter(item => item.status === 'PLANNED' || item.status === 'IN_PROGRESS');
  const rows = state.maintenance
    .slice()
    .sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime())
    .map(order => {
      const equipment = state.equipment.find(item => item.id === order.equipmentId);
      const actions = order.status === 'PLANNED'
        ? `<button class="tiny" data-maint-action="START" data-maint-id="${order.id}">▶ Запустить</button><button class="tiny danger-button" data-maint-action="CANCEL" data-maint-id="${order.id}">Отменить</button>`
        : order.status === 'IN_PROGRESS'
          ? `<button class="tiny action-complete" data-maint-action="COMPLETE" data-maint-id="${order.id}">✓ Завершить</button><button class="tiny danger-button" data-maint-action="CANCEL" data-maint-id="${order.id}">Отменить</button>`
          : '<span class="subtle">—</span>';
      return `<tr><td><strong>${typeLabel(order.type)}</strong><div class="subtle">${order.id}</div></td><td>${equipment?.name ?? order.equipmentId}</td><td>${fmt(order.plannedStart)} → ${fmt(order.plannedEnd)}</td><td><span class="status-pill ${order.status === 'DONE' ? 'status-ok' : order.status === 'CANCELLED' ? 'status-danger' : order.status === 'IN_PROGRESS' ? 'status-warning' : ''}">${statusLabel(order.status)}</span></td><td>${order.comment ?? '—'}</td><td>${actions}</td></tr>`;
    })
    .join('');

  return `<section class="panel maintenance-panel">
    <div class="panel-head"><div><h2>ППР и ремонт оборудования</h2><div class="subtle">Активных заявок: ${active.length}. Создание ППР автоматически блокирует оборудование на указанный интервал.</div></div></div>
    <form id="maintenance-form" class="maintenance-form">
      <select name="equipment" required><option value="">Оборудование</option>${state.equipment.filter(e => e.active).map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
      <select name="type"><option value="PM">ППР</option><option value="REPAIR">Ремонт</option><option value="INSPECTION">Осмотр</option></select>
      <input type="datetime-local" name="start" required>
      <input type="datetime-local" name="end" required>
      <input name="comment" placeholder="Комментарий / причина">
      <button class="primary" type="submit">Создать заявку</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Тип</th><th>Оборудование</th><th>Плановый интервал</th><th>Статус</th><th>Комментарий</th><th>Действия</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Заявок ППР/ремонтов нет</td></tr>'}</tbody></table></div>
  </section>`;
}

export function bindMaintenancePanel(root: ParentNode, options: MaintenancePanelOptions): void {
  root.querySelector<HTMLFormElement>('#maintenance-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const equipmentId = String(data.get('equipment') ?? '');
    const type = String(data.get('type') ?? 'PM') as MaintenanceOrder['type'];
    const start = String(data.get('start') ?? '');
    const end = String(data.get('end') ?? '');
    if (!equipmentId || !start || !end || new Date(start).getTime() >= new Date(end).getTime()) return;
    try {
      createMaintenanceOrder(options.state, { equipmentId, type, plannedStart: new Date(start).toISOString(), plannedEnd: new Date(end).toISOString(), comment: String(data.get('comment') ?? '') || undefined }, options.actorId);
      options.onChanged();
    } catch (error) {
      options.onError(error);
    }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-maint-action]').forEach(button => {
    button.addEventListener('click', () => {
      try {
        transitionMaintenance(options.state, button.dataset.maintId ?? '', button.dataset.maintAction as 'START' | 'COMPLETE' | 'CANCEL', options.actorId);
        options.onChanged();
      } catch (error) {
        options.onError(error);
      }
    });
  });
}
