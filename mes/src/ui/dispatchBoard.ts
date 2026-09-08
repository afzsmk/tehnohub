import { CalendarDay, Employee, Equipment, EquipmentBlock, ProductionTask, ShiftDefinition } from '../types';

export interface DispatchBoardOptions {
  tasks: ProductionTask[];
  employees: Employee[];
  equipment: Equipment[];
  shifts: ShiftDefinition[];
  calendar: CalendarDay[];
  equipmentBlocks: EquipmentBlock[];
  onMove: (taskId: string, deltaMinutes: number) => void;
  onAssignEmployee: (taskId: string, employeeId: string) => void;
  onAssignEquipment: (taskId: string, equipmentId: string) => void;
}

interface TaskIssue {
  kind: 'RESOURCE' | 'CALENDAR' | 'MAINTENANCE';
  message: string;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function dayKey(value: string | number): string {
  return new Date(typeof value === 'number' ? value : value).toISOString().slice(0, 10);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function issuesFor(task: ProductionTask, tasks: ProductionTask[], calendar: CalendarDay[], equipmentBlocks: EquipmentBlock[]): TaskIssue[] {
  const issues: TaskIssue[] = [];
  const start = new Date(task.plannedStart).getTime();
  const end = new Date(task.plannedEnd).getTime();
  const day = calendar.find(d => d.date === dayKey(start));
  if (!day?.isWorking) issues.push({ kind: 'CALENDAR', message: 'Начало задания приходится на нерабочий день.' });
  for (const other of tasks) {
    if (other.id === task.id) continue;
    const otherStart = new Date(other.plannedStart).getTime();
    const otherEnd = new Date(other.plannedEnd).getTime();
    if (overlaps(start, end, otherStart, otherEnd)) {
      const sameEmployee = task.assignedEmployeeIds.some(id => other.assignedEmployeeIds.includes(id));
      const sameEquipment = task.assignedEquipmentIds.some(id => other.assignedEquipmentIds.includes(id));
      if (sameEmployee) issues.push({ kind: 'RESOURCE', message: 'Сотрудник одновременно назначен на другое задание.' });
      if (sameEquipment) issues.push({ kind: 'RESOURCE', message: 'Оборудование одновременно используется другим заданием.' });
    }
  }
  for (const block of equipmentBlocks) {
    if (!task.assignedEquipmentIds.includes(block.equipmentId)) continue;
    const blockStart = new Date(block.start).getTime();
    const blockEnd = new Date(block.end).getTime();
    if (overlaps(start, end, blockStart, blockEnd)) {
      issues.push({ kind: 'MAINTENANCE', message: `Пересечение с блокировкой оборудования: ${block.reason}.` });
    }
  }
  return issues;
}

function findShift(taskStart: number, shifts: ShiftDefinition[], calendar: CalendarDay[]): ShiftDefinition | undefined {
  const date = calendar.find(d => d.date === dayKey(taskStart));
  if (!date) return undefined;
  for (const id of date.shiftIds) {
    const shift = shifts.find(s => s.id === id);
    if (!shift) continue;
    const dayStart = Date.UTC(new Date(taskStart).getUTCFullYear(), new Date(taskStart).getUTCMonth(), new Date(taskStart).getUTCDate());
    const start = dayStart + shift.startMinute * MINUTE_MS;
    const end = start + shift.durationMinutes * MINUTE_MS;
    if (taskStart >= start && taskStart < end) return shift;
  }
  return undefined;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function renderDispatchBoard(options: DispatchBoardOptions): string {
  const { tasks, employees, equipment, shifts, calendar, equipmentBlocks } = options;
  const visibleDays = calendar.filter(day => {
    if (!day.isWorking && day.shiftIds.length === 0) return true;
    return day.isWorking;
  });
  const cells = visibleDays.map(day => {
    const shiftLabels = day.shiftIds.map(id => shifts.find(s => s.id === id)?.name ?? id).join(' / ');
    const dayTasks = tasks.filter(task => dayKey(task.plannedStart) === day.date);
    return `<div class="dispatch-day ${day.isWorking ? '' : 'off'}">
      <div class="dispatch-day-head"><strong>${formatDate(day.date)}</strong><span>${day.isWorking ? shiftLabels : 'Выходной'}</span></div>
      <div class="dispatch-cell">
        ${dayTasks.length ? dayTasks.map(task => renderTaskCard(task, tasks, employees, equipment, shifts, calendar, equipmentBlocks, options)).join('') : '<div class="empty-cell">Нет заданий</div>'}
      </div>
    </div>`;
  }).join('');

  return `<div class="dispatch-toolbar"><div><strong>Диспетчерская доска</strong><span>${visibleDays.length} дней · ${tasks.length} заданий</span></div><div class="legend"><span><i class="dot normal"></i>Задание</span><span><i class="dot conflict-dot"></i>Конфликт</span></div></div><div class="dispatch-grid">${cells}</div>`;
}

function renderTaskCard(task: ProductionTask, tasks: ProductionTask[], employees: Employee[], equipment: Equipment[], shifts: ShiftDefinition[], calendar: CalendarDay[], equipmentBlocks: EquipmentBlock[], options: DispatchBoardOptions): string {
  const issues = issuesFor(task, tasks, calendar, equipmentBlocks);
  const employeeId = task.assignedEmployeeIds[0] ?? '';
  const equipmentId = task.assignedEquipmentIds[0] ?? '';
  const employee = employees.find(e => e.id === employeeId);
  const machine = equipment.find(e => e.id === equipmentId);
  const shift = findShift(new Date(task.plannedStart).getTime(), shifts, calendar);
  const duration = Math.max(1, Math.round((new Date(task.plannedEnd).getTime() - new Date(task.plannedStart).getTime()) / MINUTE_MS));
  const conflictHtml = issues.length ? `<div class="task-issues">${issues.map(issue => `<div>⚠ ${issue.message}</div>`).join('')}</div>` : '';
  const employeeOptions = employees.filter(e => e.active && e.qualificationLevel >= 2).map(e => `<option value="${e.id}" ${e.id === employeeId ? 'selected' : ''}>${e.name}</option>`).join('');
  const equipmentOptions = equipment.filter(e => e.active).map(e => `<option value="${e.id}" ${e.id === equipmentId ? 'selected' : ''}>${e.name}</option>`).join('');
  return `<article class="task-card ${issues.length ? 'has-conflict' : ''}">
    <div class="task-card-top"><strong>${task.id}</strong><span>${shift?.name ?? 'вне смены'}</span></div>
    <div class="task-card-title">${formatTime(task.plannedStart)}–${formatTime(task.plannedEnd)} · ${duration} мин</div>
    <div class="task-card-meta">${employee?.name ?? 'Сотрудник не назначен'} · ${machine?.name ?? 'Оборудование не назначено'}</div>
    <div class="task-controls">
      <button class="tiny" data-move="${task.id}" data-delta="-30">−30м</button>
      <button class="tiny" data-move="${task.id}" data-delta="30">+30м</button>
      <select data-employee="${task.id}" aria-label="Сотрудник"><option value="">Сотрудник</option>${employeeOptions}</select>
      <select data-equipment="${task.id}" aria-label="Оборудование"><option value="">Оборудование</option>${equipmentOptions}</select>
    </div>
    ${conflictHtml}
  </article>`;
}
