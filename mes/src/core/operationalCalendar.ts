import { CalendarDay, EmployeeSchedule, EquipmentBlock, ShiftDefinition } from '../types';

export interface TimeWindow {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function buildDefaultCalendar(horizonStart: string, horizonEnd: string, shiftIds: string[]): CalendarDay[] {
  const start = startOfUtcDay(new Date(horizonStart).getTime());
  const end = startOfUtcDay(new Date(horizonEnd).getTime());
  const days: CalendarDay[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    const weekday = new Date(cursor).getUTCDay();
    const isWorking = weekday !== 0 && weekday !== 6;
    days.push({ date: dateKey(cursor), isWorking, shiftIds: isWorking ? [...shiftIds] : [] });
  }
  return days;
}

export function buildShiftWindows(
  horizonStart: string,
  horizonEnd: string,
  shifts: ShiftDefinition[],
  calendar: CalendarDay[]
): TimeWindow[] {
  const start = new Date(horizonStart).getTime();
  const end = new Date(horizonEnd).getTime();
  const windows: TimeWindow[] = [];

  for (const day of calendar) {
    if (!day.isWorking) continue;
    const dayStart = startOfUtcDay(new Date(`${day.date}T00:00:00.000Z`).getTime());
    for (const shiftId of day.shiftIds) {
      const shift = shifts.find(s => s.id === shiftId);
      if (!shift || shift.durationMinutes <= 0) continue;
      let windowStart = dayStart + shift.startMinute * MINUTE_MS;
      let windowEnd = windowStart + shift.durationMinutes * MINUTE_MS;
      while (windowStart < dayStart + DAY_MS && windowEnd <= dayStart + DAY_MS) {
        const clippedStart = Math.max(windowStart, start);
        const clippedEnd = Math.min(windowEnd, end);
        if (clippedStart < clippedEnd) windows.push({ start: clippedStart, end: clippedEnd });
        break;
      }
    }
  }

  return windows.sort((a, b) => a.start - b.start);
}

export function employeeWindows(
  employeeId: string,
  baseWindows: TimeWindow[],
  schedules: EmployeeSchedule[]
): TimeWindow[] {
  if (schedules.length === 0) return baseWindows;
  const relevant = schedules.filter(s => s.employeeId === employeeId);
  if (relevant.length === 0) return baseWindows;
  return baseWindows.filter(window => {
    const key = dateKey(window.start);
    const schedule = relevant.find(s => s.date === key);
    if (!schedule) return false;
    return schedule.status === 'WORK' && schedule.shiftIds.length > 0;
  }).map(window => window);
}

export function subtractBlocks(windows: TimeWindow[], blocks: EquipmentBlock[]): TimeWindow[] {
  let result = [...windows];
  const sorted = [...blocks].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  for (const block of sorted) {
    const blockStart = new Date(block.start).getTime();
    const blockEnd = new Date(block.end).getTime();
    if (!(blockStart < blockEnd)) continue;
    result = result.flatMap(window => {
      if (blockEnd <= window.start || blockStart >= window.end) return [window];
      const parts: TimeWindow[] = [];
      if (window.start < blockStart) parts.push({ start: window.start, end: Math.min(window.end, blockStart) });
      if (blockEnd < window.end) parts.push({ start: Math.max(window.start, blockEnd), end: window.end });
      return parts.filter(part => part.start < part.end);
    });
  }
  return result;
}

export function intersectWindows(a: TimeWindow[], b: TimeWindow[]): TimeWindow[] {
  const result: TimeWindow[] = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (start < end) result.push({ start, end });
    }
  }
  return result.sort((x, y) => x.start - y.start);
}

export function findFittingWindow(
  candidate: number,
  durationMs: number,
  windows: TimeWindow[],
  occupied: TimeWindow[] = []
): number | null {
  let cursor = candidate;
  for (const window of windows) {
    const start = Math.max(cursor, window.start);
    if (start + durationMs > window.end) continue;
    let adjusted = start;
    let changed = true;
    while (changed) {
      changed = false;
      for (const busy of occupied) {
        if (adjusted + durationMs <= busy.start) continue;
        if (adjusted >= busy.end) continue;
        adjusted = busy.end;
        changed = true;
        if (adjusted + durationMs > window.end) break;
      }
    }
    if (adjusted + durationMs <= window.end) return adjusted;
    cursor = window.end;
  }
  return null;
}
