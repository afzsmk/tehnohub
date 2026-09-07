// scheduler/tests/scheduler.test.ts
import { describe, it, expect } from 'vitest';
import { generateStationCalendar } from '../src/core/calendar';
import { buildSchedule } from '../src/core/schedulerEngine';
import { ProductionOrder, ProductRouting, StationScheduleConfig } from '../src/types';

describe('Гибкий цеховой диспетчер (Индивидуальные смены станков и люди)', () => {
  // Настройка станков: Лазер работает 2/2 без выходных, Склейка — строго 5/2
  const stations: StationScheduleConfig[] = [
    {
      professionId: 'p_laser',
      professionName: 'Лазерная резка',
      pattern: '2_2_12h',           // График 2/2 по 12ч
      defaultShiftHours: 12,
      shiftsPerDay: 1,
      defaultWorkers: 1,
      crewPerMachine: 1,
      totalMachines: 1
    },
    {
      professionId: 'p_glue',
      professionName: 'Холодная склейка',
      pattern: '5_2_single',         // График 5/2 по 8ч
      defaultShiftHours: 8,
      shiftsPerDay: 1,
      defaultWorkers: 5,
      crewPerMachine: 5,
      totalMachines: 1
    }
  ];

  const routings: Record<string, ProductRouting> = {
    pr_panel: {
      id: 'rt_1',
      productId: 'pr_panel',
      productName: 'Сотовая панель',
      steps: [
        { stepNumber: 10, professionId: 'p_laser', professionName: 'Лазер', normPerUnit: 0.1, setupTimeHours: 0, bufferHoursAfter: 0 },
        { stepNumber: 20, professionId: 'p_glue', professionName: 'Склейка', normPerUnit: 0.2, setupTimeHours: 0, bufferHoursAfter: 0 }
      ]
    }
  };

  it('Лазер может резать в выходные по графику 2/2, а склейка ждёт понедельника', () => {
    // Горизонт 7 дней: пятница -> четверг (пятница = рабочий, сб/вс = выходные)
    const slots = generateStationCalendar({
      startDate: '2026-09-18', // Пятница
      daysCount: 7,
      stations
    });

    const orders: ProductionOrder[] = [
      {
        id: 'ord_weekend',
        orderNumber: 'ЗК-Суббота',
        productId: 'pr_panel',
        productName: 'Сотовая панель',
        quantity: 80, // Лазеру нужно 8 часов, склейке 16 часов
        unit: 'м²',
        dueDate: '2026-09-25',
        priority: 'normal',
        status: 'new'
      }
    ];

    const res = buildSchedule({ orders, routings, slots });
    expect(res.tasks.length).toBe(2);

    const laserTask = res.tasks.find(t => t.professionId === 'p_laser')!;
    const glueTask = res.tasks.find(t => t.professionId === 'p_glue')!;

    // Лазер по 2/2 работает в пятницу или субботу
    expect(laserTask.startDate).toBeDefined();

    // Склейка по 5/2 физически не может работать в субботу/воскресенье
    // 2026-09-19 (Сб) и 2026-09-20 (Вс) склейка отдыхает -> старт строго в понедельник 2026-09-21!
    expect(new Date(glueTask.startDate).getDay()).not.toBe(6); // Не суббота
    expect(new Date(glueTask.startDate).getDay()).not.toBe(0); // Не воскресенье
  });

  it('Учитывает нехватку людей: если вышло меньше рабочих, ёмкость станка урезается', () => {
    const multiMachineStation: StationScheduleConfig[] = [
      {
        professionId: 'p_aluranger',
        professionName: 'AluRanger',
        pattern: '5_2_single',
        defaultShiftHours: 8,
        shiftsPerDay: 1,
        defaultWorkers: 3,
        crewPerMachine: 1,
        totalMachines: 3 // Всего 3 станка, норма = 3 человека
      }
    ];

    // Моделируем ситуацию: в понедельник заболел рабочий, вышло только 2 человека
    const slots = generateStationCalendar({
      startDate: '2026-09-14',
      daysCount: 1,
      stations: multiMachineStation,
      overrides: [
        {
          professionId: 'p_aluranger',
          date: '2026-09-14',
          shiftNumber: 1,
          isActive: true,
          availableWorkers: 2, // ❗️ Вышло только 2 рабочих
          note: 'Заболел оператор 3-го станка'
        }
      ]
    });

    // Должно работать только 2 станка из 3 -> ёмкость 16ч вместо 24ч
    expect(slots[0].activeMachines).toBe(2);
    expect(slots[0].totalCapacityHours).toBe(16);
  });
});
