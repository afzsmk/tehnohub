import { DowntimeEvent, Employee, Equipment, ProductionResult, ProductionTask } from '../types';

export interface ExecutionPanelOptions {
  tasks: ProductionTask[];
  employees: Employee[];
  equipment: Equipment[];
  results: ProductionResult[];
  downtimes: DowntimeEvent[];
  onAction: (taskId: string, action: 'PREPARE' | 'START' | 'PAUSE' | 'RESUME' | 'BLOCK' | 'COMPLETE') => void;
  onResult: (taskId: string, goodQuantity: number, scrapQuantity: number, comment: string) => void;
  onDowntimeStart: (equipmentId: string, reasonCode: string, comment: string) => void;
  onDowntimeEnd: (downtimeId: string) => void;
}

function qualityLabel(task: ProductionTask): string {
  if (!task.qualityRequired) return '<span class="subtle">Не требуется</span>';
  switch (task.qualityStatus) {
    case 'APPROVED': return '<strong>✓ Одобрено</strong>';
    case 'REJECTED': return '<strong>✕ Отклонено</strong>';
    case 'PENDING': return '<strong>◷ Ожидает ОТК</strong>';
    default: return '<strong>◷ Требуется ОТК</strong>';
  }
}

function actionButtons(task: ProductionTask): string {
  const buttons: string[] = [];
  if (task.status === 'PLANNED' || task.status === 'ASSIGNED') {
    buttons.push(`<button class="tiny" data-action="PREPARE" data-task="${task.id}">Подготовить</button>`);
  }
  if (task.status === 'READY') {
    buttons.push(`<button class="tiny action-start" data-action="START" data-task="${task.id}">▶ Запуск</button>`);
  }
  if (task.status === 'RUNNING') {
    buttons.push(`<button class="tiny" data-action="PAUSE" data-task="${task.id}">Ⅱ Пауза</button>`);
  }
  if (task.status === 'PAUSED') {
    buttons.push(`<button class="tiny action-start" data-action="RESUME" data-task="${task.id}">▶ Продолжить</button>`);
  }
  if (task.status === 'RUNNING' || task.status === 'PAUSED' || task.status === 'PARTIALLY_COMPLETED') {
    buttons.push(`<button class="tiny" data-action="BLOCK" data-task="${task.id}">⚠ Блок</button>`);
  }
  if (task.status === 'RUNNING' || task.status === 'PARTIALLY_COMPLETED') {
    const qualityBlocked = Boolean(task.qualityRequired) && task.qualityStatus !== 'APPROVED';
    const quantityBlocked = task.actualQuantity < task.plannedQuantity;
    const disabled = qualityBlocked || quantityBlocked;
    const title = qualityBlocked
      ? 'Сначала получить одобрение ОТК'
      : quantityBlocked
        ? 'Сначала зафиксировать весь плановый выпуск'
        : '';
    buttons.push(`<button class="tiny action-complete" data-action="COMPLETE" data-task="${task.id}" ${disabled ? `disabled title="${title}"` : ''}>✓ Завершить</button>`);
  }
  return buttons.join(' ') || '<span class="subtle">—</span>';
}

export function renderExecutionPanel(options: ExecutionPanelOptions): string {
  const activeTasks = options.tasks.filter(task => !['COMPLETED', 'CANCELLED'].includes(task.status));
  const executableTasks = activeTasks.filter(task => ['RUNNING', 'PARTIALLY_COMPLETED'].includes(task.status));
  const openDowntime = options.downtimes.filter(event => !event.endedAt);
  const rows = activeTasks.map(task => {
    const employee = options.employees.find(e => e.id === task.assignedEmployeeIds[0]);
    const equipment = options.equipment.find(e => e.id === task.assignedEquipmentIds[0]);
    const taskResults = options.results.filter(r => r.taskId === task.id);
    const good = taskResults.reduce((sum, r) => sum + r.goodQuantity, 0);
    const scrap = taskResults.reduce((sum, r) => sum + r.scrapQuantity, 0);
    return `<tr>
      <td><strong>${task.id}</strong><div class="subtle">${task.status}</div></td>
      <td>${equipment?.name ?? '—'}</td>
      <td>${employee?.name ?? '—'}</td>
      <td>${good} / ${task.plannedQuantity}<br><span class="subtle">брак: ${scrap}</span></td>
      <td>${qualityLabel(task)}</td>
      <td>${actionButtons(task)}</td>
    </tr>`;
  }).join('');

  const downtimeRows = openDowntime.map(event => {
    const equipment = options.equipment.find(e => e.id === event.equipmentId);
    return `<tr><td>${equipment?.name ?? event.equipmentId}</td><td>${event.reasonCode}</td><td>${new Date(event.startedAt).toLocaleString('ru-RU')}</td><td><button class="tiny" data-end-downtime="${event.id}">Закрыть простой</button></td></tr>`;
  }).join('');

  return `<section class="panel execution-panel">
    <div class="panel-head"><div><h2>Фактическое производство</h2><div class="subtle">Запуск, пауза, завершение, выпуск годной продукции и брак</div></div></div>
    <div class="execution-grid">
      <div class="execution-table-wrap"><table><thead><tr><th>Задание</th><th>Оборудование</th><th>Сотрудник</th><th>Факт / план</th><th>ОТК</th><th>Действия</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Нет активных заданий</td></tr>'}</tbody></table></div>
      <div class="execution-side">
        <form id="result-form" class="result-form">
          <h3>Записать выпуск</h3>
          <select name="task" required><option value="">Выберите выполняемое задание</option>${executableTasks.map(t => `<option value="${t.id}">${t.id} · план ${t.plannedQuantity}${t.qualityRequired ? ' · ОТК' : ''}</option>`).join('')}</select>
          <input name="good" type="number" min="0" step="1" placeholder="Годная продукция" required>
          <input name="scrap" type="number" min="0" step="1" value="0" placeholder="Брак" required>
          <input name="comment" placeholder="Комментарий">
          <button class="primary" type="submit" ${executableTasks.length ? '' : 'disabled'}>Записать факт</button>
        </form>
        <form id="downtime-form" class="result-form">
          <h3>Начать простой</h3>
          <select name="equipment" required><option value="">Оборудование</option>${options.equipment.filter(e => e.active).map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
          <select name="reason"><option value="BREAKDOWN">Авария</option><option value="SETUP">Наладка</option><option value="MATERIAL">Нет материала</option><option value="QUALITY">Проблема качества</option><option value="OTHER">Другое</option></select>
          <input name="comment" placeholder="Причина / комментарий">
          <button class="primary" type="submit">Начать простой</button>
        </form>
      </div>
    </div>
    <div class="downtime-list"><h3>Открытые простои</h3><table><thead><tr><th>Оборудование</th><th>Причина</th><th>Начало</th><th></th></tr></thead><tbody>${downtimeRows || '<tr><td colspan="4">Открытых простоев нет</td></tr>'}</tbody></table></div>
  </section>`;
}

export function bindExecutionPanel(root: ParentNode, options: ExecutionPanelOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    button.addEventListener('click', () => options.onAction(button.dataset.task ?? '', button.dataset.action as 'PREPARE' | 'START' | 'PAUSE' | 'RESUME' | 'BLOCK' | 'COMPLETE'));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-end-downtime]').forEach(button => {
    button.addEventListener('click', () => options.onDowntimeEnd(button.dataset.endDowntime ?? ''));
  });
  root.querySelector<HTMLFormElement>('#result-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    options.onResult(
      String(data.get('task') ?? ''),
      Number(data.get('good') ?? 0),
      Number(data.get('scrap') ?? 0),
      String(data.get('comment') ?? '')
    );
  });
  root.querySelector<HTMLFormElement>('#downtime-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    options.onDowntimeStart(String(data.get('equipment') ?? ''), String(data.get('reason') ?? 'OTHER'), String(data.get('comment') ?? ''));
  });
}
