import { CalendarDay, Employee, EmployeeSchedule, Equipment, EquipmentBlock, EquipmentBlockReason, ShiftDefinition } from '../types';

export interface CalendarEditorOptions {
  calendar: CalendarDay[];
  shifts: ShiftDefinition[];
  employees: Employee[];
  employeeSchedules: EmployeeSchedule[];
  equipment: Equipment[];
  equipmentBlocks: EquipmentBlock[];
  onCalendarChange: (date: string, isWorking: boolean, shiftIds: string[]) => void | Promise<void>;
  onEmployeeScheduleChange: (employeeId: string, date: string, status: EmployeeSchedule['status'], shiftIds: string[]) => void | Promise<void>;
  onAddBlock: (block: Omit<EquipmentBlock, 'id'>) => void | Promise<void>;
  onRemoveBlock: (blockId: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function renderCalendarEditor(options: CalendarEditorOptions): string {
  const { calendar, shifts, employees, employeeSchedules, equipment, equipmentBlocks } = options;
  const days = calendar.slice(0, 30);
  const calendarRows = days.map(day => {
    const selected = new Set(day.shiftIds);
    const checks = shifts.map(shift => `<label class="shift-check"><input type="checkbox" data-day="${day.date}" data-shift="${shift.id}" ${selected.has(shift.id) ? 'checked' : ''}>${shift.name}</label>`).join('');
    return `<div class="calendar-day-row ${day.isWorking ? '' : 'off'}"><div><strong>${dateLabel(day.date)}</strong><span>${day.isWorking ? 'Рабочий' : 'Выходной'}</span></div><label class="working-toggle"><input type="checkbox" data-working="${day.date}" ${day.isWorking ? 'checked' : ''}> работа</label><div class="shift-checks">${checks}</div></div>`;
  }).join('');
  const employeeRows = employees.filter(e => e.active).map(employee => {
    const cells = days.map(day => {
      const schedule = employeeSchedules.find(s => s.employeeId === employee.id && s.date === day.date);
      const selectedShift = schedule?.status === 'WORK' ? (schedule.shiftIds[0] ?? '') : '';
      const opts = [`<option value="">Выходной</option>`, ...shifts.map(s => `<option value="${s.id}" ${s.id === selectedShift ? 'selected' : ''}>${s.name.split(' ')[0]}</option>`)].join('');
      return `<td><select class="mini-select" data-employee-day="${employee.id}|${day.date}">${opts}</select></td>`;
    }).join('');
    return `<tr><th>${employee.name}<span>разряд ${employee.qualificationLevel}</span></th>${cells}</tr>`;
  }).join('');
  const blockRows = equipmentBlocks.map(block => {
    const eq = equipment.find(item => item.id === block.equipmentId);
    return `<tr><td>${eq?.name ?? block.equipmentId}</td><td>${new Date(block.start).toLocaleString('ru-RU')} → ${new Date(block.end).toLocaleString('ru-RU')}</td><td>${block.reason}</td><td><button class="tiny danger-button" data-remove-block="${block.id}">Удалить</button></td></tr>`;
  }).join('');
  return `<div class="calendar-editor">
    <div class="editor-head"><div><h3>Операционный календарь · 30 дней</h3><p>Календарь, персональные смены и блокировки оборудования управляются из MES.</p></div></div>
    <div class="calendar-section"><div class="section-title">Производственный календарь</div><div class="calendar-day-list">${calendarRows}</div></div>
    <div class="calendar-section"><div class="section-title">Графики сотрудников</div><div class="employee-grid-wrap"><table class="employee-grid"><thead><tr><th>Сотрудник</th>${days.map(d => `<th>${dateLabel(d.date)}</th>`).join('')}</tr></thead><tbody>${employeeRows}</tbody></table></div></div>
    <div class="calendar-section"><div class="section-title">Блокировки оборудования</div>
      <form id="block-form" class="block-form">
        <select name="equipment" required>${equipment.filter(e => e.active).map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
        <input type="datetime-local" name="start" required>
        <input type="datetime-local" name="end" required>
        <select name="reason"><option value="MAINTENANCE">ТО</option><option value="REPAIR">Ремонт</option><option value="SETUP">Наладка</option><option value="OTHER">Другое</option></select>
        <input name="comment" placeholder="Комментарий">
        <button class="primary" type="submit">Добавить блокировку</button>
      </form>
      <table><thead><tr><th>Оборудование</th><th>Интервал</th><th>Причина</th><th></th></tr></thead><tbody>${blockRows || '<tr><td colspan="4">Блокировок нет</td></tr>'}</tbody></table>
    </div>
  </div>`;
}

export function bindCalendarEditor(root: ParentNode, options: CalendarEditorOptions): void {
  const reportError = (error: unknown): void => { options.onError?.(error); };
  root.querySelectorAll<HTMLInputElement>('[data-working]').forEach(input => {
    input.addEventListener('change', () => {
      const date = input.dataset.working ?? '';
      const shifts = Array.from(root.querySelectorAll<HTMLInputElement>(`[data-day="${date}"][data-shift]`)).filter(i => i.checked).map(i => i.dataset.shift ?? '').filter(Boolean);
      void Promise.resolve(options.onCalendarChange(date, input.checked, input.checked ? shifts : [])).catch(reportError);
    });
  });
  root.querySelectorAll<HTMLInputElement>('[data-day][data-shift]').forEach(input => {
    input.addEventListener('change', () => {
      const date = input.dataset.day ?? '';
      const working = root.querySelector<HTMLInputElement>(`[data-working="${date}"]`)?.checked ?? false;
      const shifts = Array.from(root.querySelectorAll<HTMLInputElement>(`[data-day="${date}"][data-shift]`)).filter(i => i.checked).map(i => i.dataset.shift ?? '').filter(Boolean);
      void Promise.resolve(options.onCalendarChange(date, working, working ? shifts : [])).catch(reportError);
    });
  });
  root.querySelectorAll<HTMLSelectElement>('[data-employee-day]').forEach(select => {
    select.addEventListener('change', () => {
      const [employeeId, date] = (select.dataset.employeeDay ?? '|').split('|');
      void Promise.resolve(options.onEmployeeScheduleChange(employeeId, date, select.value ? 'WORK' : 'OFF', select.value ? [select.value] : [])).catch(reportError);
    });
  });
  const form = root.querySelector<HTMLFormElement>('#block-form');
  if (form) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form);
      const equipmentId = String(data.get('equipment') ?? '');
      const start = String(data.get('start') ?? '');
      const end = String(data.get('end') ?? '');
      if (!equipmentId || !start || !end || new Date(start).getTime() >= new Date(end).getTime()) return;
      void Promise.resolve(options.onAddBlock({
        equipmentId,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        reason: String(data.get('reason') ?? 'OTHER') as EquipmentBlockReason,
        comment: String(data.get('comment') ?? '') || undefined
      })).catch(reportError);
    });
  }
  root.querySelectorAll<HTMLButtonElement>('[data-remove-block]').forEach(button => {
    button.addEventListener('click', () => { void Promise.resolve(options.onRemoveBlock(button.dataset.removeBlock ?? '')).catch(reportError); });
  });
}
