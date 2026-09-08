import './styles.css';
import { buildDeterministicSchedule } from './core/scheduler';
import { MesState } from './types';
import { loadState, saveState } from './services/storage';

const seed: MesState = {
  plan: { id: 'mes-demo-plan', version: 1, horizonStart: new Date().toISOString(), horizonEnd: new Date(Date.now() + 14 * 86400000).toISOString(), status: 'DRAFT' },
  products: [
    { id: 'P-001', code: 'PANEL-01', name: 'Сотовая панель', unit: 'м²' },
    { id: 'P-002', code: 'PANEL-02', name: 'Сэндвич-панель', unit: 'м²' }
  ],
  employees: [
    { id: 'E-001', personnelNo: '1001', name: 'Иванов Сергей', profession: 'Оператор участка', qualificationLevel: 3, active: true },
    { id: 'E-002', personnelNo: '1002', name: 'Петров Алексей', profession: 'Оператор участка', qualificationLevel: 2, active: true },
    { id: 'E-003', personnelNo: '1003', name: 'Смирнов Андрей', profession: 'Оператор участка', qualificationLevel: 3, active: true }
  ],
  equipment: [
    { id: 'EQ-001', code: 'LASER-01', name: 'Лазерный станок №1', workCenter: 'Лазерная резка', capabilities: ['CUT'], active: true },
    { id: 'EQ-002', code: 'GLUE-01', name: 'Пост склейки №1', workCenter: 'Склейка', capabilities: ['GLUE'], active: true }
  ],
  orders: [
    {
      id: 'O-001', number: 'ЗК-1001', productId: 'P-001', quantity: 120, completedQuantity: 0,
      dueAt: new Date(Date.now() + 5 * 86400000).toISOString(), priority: 'URGENT', status: 'RELEASED',
      route: [
        { id: 'OP-001', sequence: 10, code: 'CUT', name: 'Раскрой', workCenter: 'Лазерная резка', requiredQualification: 2, requiredEquipmentIds: ['EQ-001'], setupMinutes: 30, runMinutesPerUnit: 1.2 },
        { id: 'OP-002', sequence: 20, code: 'GLUE', name: 'Склейка', workCenter: 'Склейка', requiredQualification: 2, requiredEquipmentIds: ['EQ-002'], setupMinutes: 20, runMinutesPerUnit: 2.0 }
      ]
    },
    {
      id: 'O-002', number: 'ЗК-1002', productId: 'P-002', quantity: 80, completedQuantity: 0,
      dueAt: new Date(Date.now() + 9 * 86400000).toISOString(), priority: 'NORMAL', status: 'PLANNED',
      route: [
        { id: 'OP-003', sequence: 10, code: 'CUT', name: 'Раскрой', workCenter: 'Лазерная резка', requiredQualification: 2, requiredEquipmentIds: ['EQ-001'], setupMinutes: 30, runMinutesPerUnit: 1.0 },
        { id: 'OP-004', sequence: 20, code: 'GLUE', name: 'Склейка', workCenter: 'Склейка', requiredQualification: 2, requiredEquipmentIds: ['EQ-002'], setupMinutes: 20, runMinutesPerUnit: 1.7 }
      ]
    }
  ],
  tasks: [], downtimes: [], maintenance: [], results: [], events: []
};

const state = loadState(seed);
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения');
const root = app;

function render(): void {
  const schedule = buildDeterministicSchedule({ orders: state.orders, employees: state.employees, equipment: state.equipment, horizonStart: state.plan.horizonStart, horizonEnd: state.plan.horizonEnd });
  state.tasks = schedule.tasks;
  saveState(state);

  const completed = state.results.reduce((sum, r) => sum + r.goodQuantity, 0);
  const downtime = state.downtimes.length;
  const blocked = schedule.conflicts.length;

  root.innerHTML = `
    <header class="topbar">
      <div><div class="eyebrow">ТЕХНОХАБ ЗСМК</div><h1>MES • Производственное управление</h1></div>
      <div class="plan-badge">План v${state.plan.version} · ${state.plan.status}</div>
    </header>
    <main class="page">
      <section class="kpis">
        <article><span>Заказы</span><strong>${state.orders.length}</strong></article>
        <article><span>Задания</span><strong>${state.tasks.length}</strong></article>
        <article><span>Выпущено</span><strong>${completed}</strong></article>
        <article class="${blocked ? 'danger' : ''}"><span>Конфликты</span><strong>${blocked}</strong></article>
        <article><span>Простои</span><strong>${downtime}</strong></article>
      </section>
      <section class="grid-2">
        <div class="panel"><div class="panel-head"><h2>Оперативный план</h2><button id="recalc" class="primary">Пересчитать</button></div>
          <table><thead><tr><th>Заказ</th><th>Приоритет</th><th>Срок</th><th>Статус</th></tr></thead><tbody>
            ${state.orders.map(o => `<tr><td><strong>${o.number}</strong></td><td>${o.priority}</td><td>${new Date(o.dueAt).toLocaleDateString('ru-RU')}</td><td>${o.status}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div class="panel"><div class="panel-head"><h2>Диспетчерская лента</h2></div>
          <table><thead><tr><th>Задание</th><th>Операция</th><th>Старт</th><th>Финиш</th><th>Сотрудник</th><th>Станок</th></tr></thead><tbody>
            ${state.tasks.map(t => {
              const op = state.orders.flatMap(o => o.route).find(x => x.id === t.operationId);
              const e = state.employees.find(x => x.id === t.assignedEmployeeIds[0]);
              const eq = state.equipment.find(x => x.id === t.assignedEquipmentIds[0]);
              return `<tr><td>${t.id}</td><td>${op?.name ?? t.operationId}</td><td>${new Date(t.plannedStart).toLocaleString('ru-RU')}</td><td>${new Date(t.plannedEnd).toLocaleString('ru-RU')}</td><td>${e?.name ?? '—'}</td><td>${eq?.name ?? '—'}</td></tr>`;
            }).join('')}
          </tbody></table>
        </div>
      </section>
      ${blocked ? `<section class="panel conflict"><h2>Почему план не выполним</h2><ul>${schedule.conflicts.map(c => `<li><strong>${c.code}</strong> · ${c.message}</li>`).join('')}</ul></section>` : ''}
    </main>`;

  document.querySelector<HTMLButtonElement>('#recalc')?.addEventListener('click', render);
}

render();
