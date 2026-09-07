// scheduler/src/services/schedulerStorage.ts
import { ProductionOrder, ProductRouting, StationScheduleConfig, ShiftOverride } from '../types';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const STORAGE_ORDERS = 'zsmk_sched_orders_v2';
const STORAGE_ROUTINGS = 'zsmk_sched_routings_v2';
const STORAGE_STATIONS = 'zsmk_sched_stations_v2';
const STORAGE_OVERRIDES = 'zsmk_sched_overrides_v2';

export const DEFAULT_STATIONS: StationScheduleConfig[] = [
  { professionId: 'p1', professionName: 'AluRanger', pattern: '5_2_single', defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 3, crewPerMachine: 1, totalMachines: 3 },
  { professionId: 'p1787298947495', professionName: 'Лазерная резка', pattern: '2_2_12h', defaultShiftHours: 12, shiftsPerDay: 1, defaultWorkers: 1, crewPerMachine: 1, totalMachines: 1 },
  { professionId: 'p2', professionName: 'Холодная склейка', pattern: '5_2_single', defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 5, crewPerMachine: 5, totalMachines: 1 },
  { professionId: 'p1787921989265', professionName: 'Гибочник', pattern: '5_2_single', defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 1, crewPerMachine: 1, totalMachines: 1 },
  { professionId: 'p6', professionName: 'Сборочный пост', pattern: '5_2_single', defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 4, crewPerMachine: 1, totalMachines: 4 },
  { professionId: 'p1787298961438', professionName: 'Покраска', pattern: '5_2_single', defaultShiftHours: 8, shiftsPerDay: 1, defaultWorkers: 1, crewPerMachine: 1, totalMachines: 1 }
];

export const DEFAULT_ROUTINGS: Record<string, ProductRouting> = {
  pr1: {
    id: 'rt_pr1',
    productId: 'pr1',
    productName: 'Сотовые панели Кемерово',
    steps: [
      { stepNumber: 10, professionId: 'p1787298947495', professionName: 'Лазерная резка', normPerUnit: 0.036, setupTimeHours: 0.5, bufferHoursAfter: 0 },
      { stepNumber: 20, professionId: 'p1', professionName: 'AluRanger', normPerUnit: 0.646, setupTimeHours: 0.5, bufferHoursAfter: 0 },
      { stepNumber: 30, professionId: 'p2', professionName: 'Холодная склейка', normPerUnit: 0.718, setupTimeHours: 1.0, bufferHoursAfter: 4 },
      { stepNumber: 40, professionId: 'p6', professionName: 'Сборочный пост', normPerUnit: 2.165, setupTimeHours: 0.5, bufferHoursAfter: 0 }
    ]
  },
  pr2: {
    id: 'rt_pr2',
    productId: 'pr2',
    productName: 'Сэндвичи Кемерово',
    steps: [
      { stepNumber: 10, professionId: 'p1787298947495', professionName: 'Лазерная резка', normPerUnit: 0.036, setupTimeHours: 0.5, bufferHoursAfter: 0 },
      { stepNumber: 20, professionId: 'p2', professionName: 'Холодная склейка', normPerUnit: 0.718, setupTimeHours: 1.0, bufferHoursAfter: 2 }
    ]
  }
};

export const DEFAULT_ORDERS: ProductionOrder[] = [
  { id: 'ord_1', orderNumber: 'ЗК-104', customer: 'Инкерман', productId: 'pr1', productName: 'Сотовые панели Кемерово', quantity: 45, unit: 'м²', dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), priority: 'urgent', status: 'new' },
  { id: 'ord_2', orderNumber: 'ЗК-105', customer: 'Кемерово-Фасад', productId: 'pr1', productName: 'Сотовые панели Кемерово', quantity: 70, unit: 'м²', dueDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10), priority: 'normal', status: 'new' },
  { id: 'ord_3', orderNumber: 'ЗК-106', customer: 'Севастополь', productId: 'pr2', productName: 'Сэндвичи Кемерово', quantity: 120, unit: 'м²', dueDate: new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10), priority: 'normal', status: 'new' }
];

export const schedulerStorage = {
  async loadData() {
    let orders: ProductionOrder[] = DEFAULT_ORDERS;
    let routings: Record<string, ProductRouting> = DEFAULT_ROUTINGS;
    let stations: StationScheduleConfig[] = DEFAULT_STATIONS;
    let overrides: ShiftOverride[] = [];

    // Загрузка из Supabase
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: dbOrders } = await supabase.from('scheduler_orders').select('*');
        if (dbOrders && dbOrders.length > 0) {
          orders = dbOrders.map((r: any) => ({
            id: r.id,
            orderNumber: r.order_number,
            customer: r.customer,
            productId: r.product_id,
            productName: r.product_name,
            quantity: Number(r.quantity),
            unit: r.unit,
            dueDate: r.due_date,
            priority: r.priority,
            status: r.status,
            notes: r.notes
          }));
        }

        const { data: dbRoutings } = await supabase.from('scheduler_routings').select('*');
        if (dbRoutings && dbRoutings.length > 0) {
          routings = {};
          dbRoutings.forEach((r: any) => {
            routings[r.product_id] = {
              id: r.id,
              productId: r.product_id,
              productName: r.product_name,
              steps: r.steps || []
            };
          });
        }
      } catch (err) {
        console.warn('Загрузка из Supabase не удалась, используем кэш:', err);
      }
    }

    // Локальный кэш
    const localOrd = localStorage.getItem(STORAGE_ORDERS);
    if (localOrd) orders = JSON.parse(localOrd);

    const localRt = localStorage.getItem(STORAGE_ROUTINGS);
    if (localRt) routings = JSON.parse(localRt);

    const localSt = localStorage.getItem(STORAGE_STATIONS);
    if (localSt) stations = JSON.parse(localSt);

    const localOv = localStorage.getItem(STORAGE_OVERRIDES);
    if (localOv) overrides = JSON.parse(localOv);

    return { orders, routings, stations, overrides };
  },

  async saveOrders(orders: ProductionOrder[]) {
    localStorage.setItem(STORAGE_ORDERS, JSON.stringify(orders));
    if (isSupabaseConfigured() && supabase) {
      const rows = orders.map(o => ({
        id: o.id,
        order_number: o.orderNumber,
        customer: o.customer,
        product_id: o.productId,
        product_name: o.productName,
        quantity: o.quantity,
        unit: o.unit,
        due_date: o.dueDate,
        priority: o.priority,
        status: o.status,
        notes: o.notes,
        updated_at: new Date().toISOString()
      }));
      await supabase.from('scheduler_orders').upsert(rows);
    }
  },

  async saveRoutings(routings: Record<string, ProductRouting>) {
    localStorage.setItem(STORAGE_ROUTINGS, JSON.stringify(routings));
    if (isSupabaseConfigured() && supabase) {
      const rows = Object.values(routings).map(rt => ({
        id: rt.id,
        product_id: rt.productId,
        product_name: rt.productName,
        steps: rt.steps,
        updated_at: new Date().toISOString()
      }));
      await supabase.from('scheduler_routings').upsert(rows);
    }
  },

  saveStations(stations: StationScheduleConfig[]) {
    localStorage.setItem(STORAGE_STATIONS, JSON.stringify(stations));
  },

  saveOverrides(overrides: ShiftOverride[]) {
    localStorage.setItem(STORAGE_OVERRIDES, JSON.stringify(overrides));
  }
};
