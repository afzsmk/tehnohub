import type { ProductionTask, QualityInspection, UserRole } from '../types';

export interface QualityPanelOptions {
  tasks: ProductionTask[];
  inspections: QualityInspection[];
  role?: UserRole;
  onRequest: (taskId: string) => void;
  onDecision: (taskId: string, status: 'APPROVED'|'REJECTED', goodQuantity: number, scrapQuantity: number, defectCode: string, comment: string) => void;
}

function label(status: ProductionTask['qualityStatus']): string {
  return status === 'APPROVED' ? 'ОТК: принято' : status === 'REJECTED' ? 'ОТК: отклонено' : status === 'PENDING' ? 'ОТК: ожидает' : 'ОТК: не требуется';
}

export function renderQualityPanel(options: QualityPanelOptions): string {
  const active = options.tasks.filter(t => !['COMPLETED','CANCELLED'].includes(t.status));
  const pending = active.filter(t => t.qualityRequired && t.qualityStatus === 'PENDING');
  const canInspect = options.role === 'QUALITY' || options.role === 'ADMIN' || options.role === 'PRODUCTION_MANAGER';
  const requestable = options.role === 'OPERATOR' || options.role === 'QUALITY' || options.role === 'MASTER' || options.role === 'ADMIN' || options.role === 'PRODUCTION_MANAGER';
  const rows = active.map(task => {
    const inspection = [...options.inspections].reverse().find(item => item.taskId === task.id);
    const controls = task.qualityRequired
      ? task.qualityStatus === 'PENDING' && canInspect
        ? `<button class="tiny" data-quality-review="${task.id}">Проверить ОТК</button>`
        : (requestable && task.qualityStatus !== 'PENDING' && task.status !== 'COMPLETED' ? `<button class="tiny" data-quality-request="${task.id}">Запросить ОТК</button>` : '')
      : '<span class="subtle">Не требуется</span>';
    return `<tr><td><strong>${task.id}</strong><div class="subtle">операция ${task.operationSequence}</div></td><td>${label(task.qualityStatus)}${inspection?.defectCode ? `<div class="subtle">дефект: ${inspection.defectCode}</div>` : ''}</td><td>${inspection ? new Date(inspection.inspectedAt).toLocaleString('ru-RU') : '—'}</td><td>${controls}</td></tr>`;
  }).join('');

  return `<section class="panel quality-panel"><div class="panel-head"><div><h2>ОТК / качество</h2><div class="subtle">${pending.length} заданий ожидают решения${canInspect ? ' · доступно инспектору' : ''}</div></div></div>
    <div class="execution-table-wrap"><table><thead><tr><th>Задание</th><th>Статус качества</th><th>Последняя проверка</th><th>Действие</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Нет активных заданий</td></tr>'}</tbody></table></div>
    <form id="quality-form" class="result-form" hidden><h3>Решение ОТК</h3><input type="hidden" name="task"><select name="status"><option value="APPROVED">Принято</option><option value="REJECTED">Отклонено</option></select><input name="good" type="number" min="0" step="1" value="1" placeholder="Годное" required><input name="scrap" type="number" min="0" step="1" value="0" placeholder="Брак" required><input name="defect" placeholder="Код дефекта (для отклонения)"><input name="comment" placeholder="Комментарий ОТК"><button class="primary" type="submit">Сохранить решение</button></form>
  </section>`;
}

export function bindQualityPanel(root: ParentNode, options: QualityPanelOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-quality-request]').forEach(button => button.addEventListener('click', () => options.onRequest(button.dataset.qualityRequest ?? '')));
  root.querySelectorAll<HTMLButtonElement>('[data-quality-review]').forEach(button => button.addEventListener('click', () => {
    const form = root.querySelector<HTMLFormElement>('#quality-form');
    if (!form) return;
    form.hidden = false;
    (form.elements.namedItem('task') as HTMLInputElement).value = button.dataset.qualityReview ?? '';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  root.querySelector<HTMLFormElement>('#quality-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    options.onDecision(
      String(data.get('task') ?? ''), String(data.get('status') ?? 'APPROVED') as 'APPROVED'|'REJECTED',
      Number(data.get('good') ?? 0), Number(data.get('scrap') ?? 0), String(data.get('defect') ?? ''), String(data.get('comment') ?? '')
    );
  });
}
