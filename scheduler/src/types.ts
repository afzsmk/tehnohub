// scheduler/src/types.ts

export type OrderPriority = 'urgent' | 'normal' | 'low';
export type OrderStatus = 'new' | 'scheduled' | 'in_progress' | 'completed' | 'overdue';
export type OperationStatus = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'delayed';

// 1. БАЗОВЫЙ ШАБЛОН ГРАФИКА ДЛЯ УЧАСТКА
export type SchedulePattern = '5_2_single' | '5_2_double' | '2_2_12h' | 'continuous_24h' | 'custom';

export interface StationScheduleConfig {
  professionId: string;       // ID участка (например "p1" - AluRanger, "p1787298947495" - Лазер)
  professionName: string;
  pattern: SchedulePattern;   // Типовой режим
  defaultShiftHours: number;  // 8, 11 или 12 часов
  shiftsPerDay: 1 | 2;        // 1 или 2 смены
  defaultWorkers: number;     // Сколько рабочих по штату
  crewPerMachine: number;     // Звено на 1 станок (из workforce)
  totalMachines: number;      // Физических станков (из workforce)
}

// 2. РУЧНАЯ КОРРЕКТИРОВКА НА КОНКРЕТНЫЙ ДЕНЬ / СМЕНУ (Точечный факт и график)
export interface ShiftOverride {
  professionId: string;
  date: string;               // ГГГГ-ММ-ДД
  shiftNumber: 1 | 2;
  isActive: boolean;          // Работает ли пост (можно отключить в рабочий день или включить в выходной)
  shiftHours?: number;        // Изменение длины смены на этот день (например, вывели на 4ч или 12ч)
  availableWorkers?: number;  // Сколько людей физически вышло (если вышло 2 вместо 3 — станки простаивают)
  isMaintenance?: boolean;    // ППР / Ремонт станка
  note?: string;              // Примечание ("Заболел оператор", "Срочный выход в субботу")
}

// 3. ФАКТИЧЕСКИЙ СЛОТ ДОСТУПНОЙ МОЩНОСТИ СТАНКА НА СМЕНУ
export interface StationShiftSlot {
  professionId: string;
  professionName: string;
  date: string;
  shiftNumber: 1 | 2;
  isWorking: boolean;         // Работает ли станок в эту смену
  shiftHours: number;         // Длина смены
  availableWorkers: number;   // Доступно людей
  activeMachines: number;     // Сколько станков реально могут работать (с учётом людей и физ. станков)
  totalCapacityHours: number; // Итого станко-часов: activeMachines * shiftHours
  isWeekend: boolean;
  isOverride: boolean;        // Была ли ручная правка
  note?: string;
}

// 4. ЗАКАЗ / ПАРТИЯ В БЭКЛОГЕ
export interface ProductionOrder {
  id: string;
  orderNumber: string;        // "ЗК-104"
  customer?: string;          // "Инкерман"
  productId: string;          // Ссылка на изделие
  productName: string;        // "Сотовые панели Кемерово"
  quantity: number;           // 150
  unit: string;               // "м²"
  dueDate: string;            // Дата сдачи "2026-09-22"
  priority: OrderPriority;
  status: OrderStatus;
  notes?: string;
  createdAt?: string;
}

// 5. ТЕХНОЛОГИЧЕСКИЙ МАРШРУТ
export interface RoutingStep {
  stepNumber: number;         // 10, 20, 30
  professionId: string;       // "p1"
  professionName: string;     // "AluRanger"
  normPerUnit: number;        // н-ч/ед
  setupTimeHours: number;     // Тпз (переналадка, ч)
  bufferHoursAfter: number;   // Межоперационный буфер (сушка, перемещение, ч)
}

export interface ProductRouting {
  id: string;
  productId: string;
  productName: string;
  steps: RoutingStep[];
}

// 6. ОПЕРАЦИЯ В РАСПИСАНИИ (БЛОК НА ГАНТЕ)
export interface ScheduledTask {
  id: string;
  orderId: string;
  orderNumber: string;
  customer?: string;
  productId: string;
  productName: string;
  stepNumber: number;
  professionId: string;
  professionName: string;
  quantity: number;
  unit: string;
  
  startDate: string;
  startShift: 1 | 2;
  endDate: string;
  endShift: 1 | 2;
  
  plannedHours: number;
  status: OperationStatus;
  isOverdue: boolean;
}

// 7. СУТОЧНАЯ ТЕПЛОВАЯ КАРТА
export interface StationDayLoad {
  professionId: string;
  professionName: string;
  date: string;
  capacityHours: number;      // Реальная емкость с учетом людей и станков
  scheduledHours: number;
  loadPercent: number;
  zone: 'empty' | 'low' | 'ok' | 'warn' | 'danger';
}
