// src/ui/charts.ts
import Chart from 'chart.js/auto';
import { CalculationResult, ScenarioData, AnalysisDisplayMode } from '../types';

let staffChartInstance: Chart | null = null;
let productsChartInstance: Chart | null = null;

export function renderCharts(calc: CalculationResult, data: ScenarioData, mode: AnalysisDisplayMode = 'auto'): void {
  const palette = ['#0284c7', '#d97706', '#dc2626', '#7c3aed', '#059669', '#4b5563', '#ea580c', '#8b5cf6'];

  if (staffChartInstance) staffChartInstance.destroy();
  if (productsChartInstance) productsChartInstance.destroy();

  const staffDatasets = mode === 'compare'
    ? [
        { label: 'Пиковый/помесячный штат · 8 ч', data: calc.workforceViews['8h'].grandTotalStaff, backgroundColor: '#0284c7' },
        { label: 'Пиковый/помесячный штат · 12 ч', data: calc.workforceViews['12h'].grandTotalStaff, backgroundColor: '#059669' }
      ]
    : [
        {
          label: `Универсальный пул (${calc.brigadesCount} бриг. по ${calc.brigadeSize} чел)`,
          data: calc.universalStaffSpTotal.map(v => parseFloat(v.toFixed(1))),
          backgroundColor: '#0284c7',
          stack: 'main'
        },
        ...calc.dedicatedProfs.map((prof, idx) => ({
          label: `Выделенный: ${prof.name}`,
          data: calc.staffByProfSp[prof.id].map(v => parseFloat(v.toFixed(1))),
          backgroundColor: palette[(idx + 1) % palette.length],
          stack: 'main'
        })),
        {
          label: 'Вспомогательный персонал',
          data: calc.auxStaffSpTotal.map(v => parseFloat(v.toFixed(1))),
          backgroundColor: '#94a3b8',
          stack: 'main'
        }
      ];

  const ctxStaff = (document.getElementById("chartStaffMonthly") as HTMLCanvasElement | null)?.getContext("2d");
  if (ctxStaff) {
    staffChartInstance = new Chart(ctxStaff, {
      type: 'bar',
      data: { labels: data.months, datasets: staffDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: { mode: 'index', intersect: false },
          legend: { position: 'top', labels: { boxWidth: 11, font: { size: 11 } } }
        },
        scales: {
          x: { stacked: mode !== 'compare' },
          y: { stacked: mode !== 'compare', title: { display: true, text: 'Штат (чел.)' }, beginAtZero: true }
        }
      }
    });
  }

  const activeProducts = data.products.filter(p => calc.hoursByProduct[p.id].reduce((a, b) => a + b, 0) > 0);
  const activeHours = activeProducts.map(p => calc.hoursByProduct[p.id].reduce((a, b) => a + b, 0));

  const ctxProd = (document.getElementById("chartProductsShare") as HTMLCanvasElement | null)?.getContext("2d");
  if (ctxProd) {
    productsChartInstance = new Chart(ctxProd, {
      type: 'doughnut',
      data: {
        labels: activeProducts.map(p => `${p.name}`),
        datasets: [{ data: activeHours.map(h => Math.round(h)), backgroundColor: palette.slice(0, activeProducts.length) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right', // Крупный круг с легендой справа
            labels: { boxWidth: 11, font: { size: 11 } }
          }
        }
      }
    });
  }
}
