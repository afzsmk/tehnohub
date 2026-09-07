// scheduler/src/types.ts

export type OrderPriority = 'urgent' | 'normal' | 'low';
export type OrderStatus = 'new' | 'scheduled' | 'in_progress' | 'completed' | 'overdue';
export type OperationStatus = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'delayed';

// 1. ЗАКАЗ / ПАРТИЯ В БЭКЛОГЕ
export interface ProductionOrder {
  id: string;
  orderNumber: string;        // Номер заказа (например: "ЗК-104")
  customer?: string;          // Заказчик (например: "Инкерман")
  productId: string;          // Ссылка на изделие из workforce
  productName: string;        // Название изделия ("Сотовые панели Кемерово")
  quantity: number;           // Объем партии (например: 150)
  unit: string;               // Ед. изм. ("м²", "шт")
  dueDate: string;            // Дата сдачи заказчику (ГГГГ-ММ-ДД: "2026-09-22")
  priority: OrderPriority;    // Приоритет
  status: OrderStatus;        // Текущий статус
  notes?: string;             // Примечания (особые требования к упаковке, цвет)
  createdAt?: string;
}

// 2. ТЕХНОЛОГИЧЕСКИЙ ШАГ МАРШРУТА ИЗДЕЛИЯ
export interface RoutingStep {
  stepNumber: number;         // Порядковый номер (10, 20, 30...)
  professionId: string;       // Станка/участок (например: "p1" - AluRanger)
  professionName: string;     // "AluRanger", "Лазерная резка", "Холодная склейка"
  normPerUnit: number;        // Норма времени (н-ч/ед), берется из workforce
  setupTimeHours: number;     // Время переналадки станка перед партией (Tпз, ч)
  bufferHoursAfter: number;   // Время высыхания / межоперационного буфера перед следующим шагом (ч)
}

// 3. ПОЛНЫЙ МАРШРУТ ИЗДЕЛИЯ
export interface ProductRouting {
  id: string;
  productId: string;
  productName: string;
  steps: RoutingStep[];
}

// 4. ОПИСАНИЕ СМЕНЫ И СТАНКА
export interface ShiftSlot {
  date: string;               // Дата (ГГГГ-ММ-ДД: "2026-09-15")
  shiftNumber: 1 | 2;         // 1 смена (день) или 2 смена (вечер)
  durationHours: number;      // Длительность доступного фонда (8ч, 11ч, 12ч)
  isWeekend: boolean;         // Выходной день
  isMaintenance: boolean;     // Станок на плановом ремонте (ППР)
}

// 5. ОПЕРАЦИЯ, РАЗМЕЩЁННАЯ В РАСПИСАНИИ (БЛОК НА ДИАГРАММЕ ГАНТА)
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
  
  // Временные координаты
  startDate: string;          // Дата начала (ГГГГ-ММ-ДД)
  startShift: 1 | 2;
  endDate: string;            // Дата завершения (ГГГГ-ММ-ДД)
  endShift: 1 | 2;
  
  plannedHours: number;       // Сколько часов займет (Кол-во * Норма + Тпз)
  status: OperationStatus;
  isOverdue: boolean;         // Флаг риска срыва дедлайна заказа
  
  // Фактические данные со смены
  factQuantity?: number;
  factScrap?: number;
  factMasterNote?: string;
}

// 6. СУТОЧНАЯ ЗАГРУЗКА СТАНКА (ДЛЯ ТЕПЛОВОЙ КАРТЫ)
export interface StationDayLoad {
  professionId: string;
  professionName: string;
  date: string;
  capacityHours: number;      // Доступная емкость (с учетом длины смен)
  scheduledHours: number;     // Занято плановыми заказами
  loadPercent: number;        // Процент загрузки (0% - 150%)
  zone: 'empty' | 'low' | 'ok' | 'warn' | 'danger'; // 0%, <50%, 70-95%, 95-100%, >100%
}
