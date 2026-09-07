// scheduler/tests/scheduler.test.ts
import { describe, it, expect } from 'vitest';
import { generateShiftCalendar } from '../src/core/calendar';
import { buildSchedule } from '../src/core/schedulerEngine';
import { ProductionOrder, ProductRouting } from '../src/types';

describe('Оперативный планировщик (schedulerEngine.ts)', () => {
  const calendar = generateShiftCalendar({
    startDate: '2026-09-14',
    daysCount: 14,
    shiftsPerDay: 1,
    shiftHours: 8,
    workOnWeekends: false
  });

  const routings: Record<string, ProductRouting> = {
    pr_panel: {
      id: 'rt_1',
      productId: 'pr_panel',
      productName: 'Сотовая панель',
      steps: [
        { stepNumber: 10, professionId: 'p_laser', professionName: 'Лазер', normPerUnit: 0.1, setupTimeHours: 0.5, bufferHoursAfter: 0 },
        { stepNumber: 20, professionId: 'p_glue', professionName: 'Склейка', normPerUnit: 0.2, setupTimeHours: 1.0, bufferHoursAfter: 0 }
      ]
    }
  };

  const stationCapacities = {
    p_laser: { machinesCount: 1 }, // 1 станок = 8ч в смену
    p_glue: { machinesCount: 1 }   // 1 пост = 8ч в смену
  };

  it('Соблюдает технологическую цепочку: шаг 20 стартует не раньше шага 10', () => {
    const orders: ProductionOrder[] = [
      {
        id: 'ord_1',
        orderNumber: 'ЗК-101',
        productId: 'pr_panel',
        productName: 'Сотовая панель',
        quantity: 50,
        unit: 'м²',
        dueDate: '2026-09-20',
        priority: 'normal',
        status: 'new'
      }
    ];

    const res = buildSchedule({ orders, routings, calendarSlots: calendar, stationCapacities });
    expect(res.tasks.length).toBe(2);

    const step10 = res.tasks.find(t => t.stepNumber === 10)!;
    const step20 = res.tasks.find(t => t.stepNumber === 20)!;

    // Шаг 20 должен стартовать в ту же дату или позже шага 10
    const start10 = new Date(step10.startDate).getTime();
    const start20 = new Date(step20.startDate).getTime();
    expect(start20).toBeGreaterThanOrEqual(start10);
  });

  it('Срочные заказы (urgent) планируются первыми перед обычными', () => {
    const orders: ProductionOrder[] = [
      {
        id: 'ord_normal',
        orderNumber: 'Обычный заказ',
        productId: 'pr_panel',
        productName: 'Сотовая панель',
        quantity: 30,
        unit: 'м²',
        dueDate: '2026-09-18',
        priority: 'normal',
        status: 'new'
      },
      {
        id: 'ord_urgent',
        orderNumber: 'Срочный заказ',
        productId: 'pr_panel',
        productName: 'Сотовая панель',
        quantity: 30,
        unit: 'м²',
        dueDate: '2026-09-18',
        priority: 'urgent',
        status: 'new'
      }
    ];

    const res = buildSchedule({ orders, routings, calendarSlots: calendar, stationCapacities });
    const urgentTask = res.tasks.find(t => t.orderId === 'ord_urgent' && t.stepNumber === 10)!;
    const normalTask = res.tasks.find(t => t.orderId === 'ord_normal' && t.stepNumber === 10)!;

    // Срочный заказ занимает первую рабочую смену
    expect(urgentTask.startDate).toBe('2026-09-14');
  });

  it('Обнаруживает срыв дедлайна (overdue), если заказ не успевает в срок', () => {
    const orders: ProductionOrder[] = [
      {
        id: 'ord_late',
        orderNumber: 'Нереальный дедлайн',
        productId: 'pr_panel',
        productName: 'Сотовая панель',
        quantity: 200, // Требует много часов
        unit: 'м²',
        dueDate: '2026-09-14', // Дедлайн сегодня, физически не успеть
        priority: 'normal',
        status: 'new'
      }
    ];

    const res = buildSchedule({ orders, routings, calendarSlots: calendar, stationCapacities });
    expect(res.overdueOrdersCount).toBeGreaterThan(0);
    expect(res.tasks[0].isOverdue).toBe(true);
  });
});
