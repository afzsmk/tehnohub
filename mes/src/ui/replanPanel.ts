import { applyReplan, previewDowntimeReplan, ReplanPreview } from '../core/planFact';
import { DowntimeEvent, OperationalPlan, ProductionTask } from '../types';

interface ReplanPanelOptions {
  tasks: ProductionTask[];
  downtimes: DowntimeEvent[];
  plan: OperationalPlan;
  onApply: (preview: ReplanPreview) => void;
}

const fmt = (value: string) => new Date(value).toLocaleString('ru-RU');

export function renderReplanPanel({ tasks, downtimes, plan }: ReplanPanelOptions): string {
  const preview = previewDowntimeReplan(tasks, downtimes, plan.horizonEnd);
  if (!preview.affected.length && !preview.conflicts.length) {
    return `<section class="panel replan-panel replan-ok"><div class="panel-head"><div><h2>Перепланирование</h2><div class="subtle">Изменений, вызванных простоями, не обнаружено.</div></div><span class="status-pill status-ok">График стабилен</span></div></section>`;
  }
  const rows = preview.affected.map(item => `<tr><td>${item.taskId}</td><td>${item.reason === 'DOWNTIME' ? 'Простой' : 'Каскад'}</td><td>${fmt(item.oldStart)} → ${fmt(item.oldEnd)}</td><td>${fmt(item.newStart)} → ${fmt(item.newEnd)}</td><td>+${item.deltaMinutes} мин</td></tr>`).join('');
  const conflictRows = preview.conflicts.map(item => `<div class="replan-conflict"><strong>${item.taskId}</strong><span>${item.message}</span></div>`).join('');
  const changes = preview.affected.map(item => ({
    taskId: item.taskId,
    proposedStart: item.newStart,
    proposedEnd: item.newEnd,
    expectedVersion: tasks.find(task => task.id === item.taskId)?.version ?? 0
  }));
  const encodedChanges = encodeURIComponent(JSON.stringify(changes));
  return `<section class="panel replan-panel"><div class="panel-head"><div><h2>Требуется перепланирование</h2><div class="subtle">Предварительный пересчёт. Текущий график не изменён.</div></div><span class="status-pill ${preview.conflicts.length ? 'status-danger' : 'status-warning'}">${preview.affected.length} изменений</span></div>${preview.affected.length ? `<div class="table-wrap"><table><thead><tr><th>Задание</th><th>Причина</th><th>Было</th><th>Станет</th><th>Сдвиг</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}${preview.conflicts.length ? `<div class="replan-conflicts"><div class="subtle">Конфликты горизонта: ${preview.conflicts.length}</div>${conflictRows}</div>` : ''}<div class="replan-actions"><button id="replan-apply" class="primary" data-plan-id="${plan.id}" data-plan-version="${plan.version}" data-changes="${encodedChanges}" ${preview.affected.length ? '' : 'disabled'}>Применить перепланирование</button><span class="subtle">После подтверждения версия плана увеличится.</span></div></section>`;
}

export function bindReplanPanel(root: HTMLElement, options: ReplanPanelOptions): void {
  root.querySelector<HTMLButtonElement>('#replan-apply')?.addEventListener('click', () => {
    const preview = previewDowntimeReplan(options.tasks, options.downtimes, options.plan.horizonEnd);
    if (!preview.affected.length) return;
    options.onApply(preview);
  });
}

export function applyApprovedReplan(tasks: ProductionTask[], preview: ReplanPreview): void {
  applyReplan(tasks, preview);
}
