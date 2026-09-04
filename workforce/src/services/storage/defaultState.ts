// src/services/storage/defaultState.ts
import { AppState } from '../../types';

export const PRELOADED_STATE: AppState = {
  currentScenario: "План сент-окт 2026",
  scenarios: {
    "План сент-окт 2026": {
      professions: [
        { id: "p1", name: "AluRanger", pool: "universal", type: "machine", crew: 3, machines: 3 },
        { id: "p2", name: "Холодная склейка", pool: "universal", machines: 1, crew: 5, type: "machine" },
        { id: "p3", name: "Брикеты", pool: "universal", type: "machine", crew: 3, machines: 1 },
        { id: "p4", name: "Горячая склейка", pool: "universal", type: "machine", crew: 6, machines: 1 },
        { id: "p5", name: "Участок обработки алюминия", pool: "universal", crew: 6, type: "machine", machines: 1 },
        { id: "p6", name: "Сборочный пост", pool: "universal", machines: 4, crew: 4, type: "manual" },
        { id: "p7", name: "Подсобный рабочий", pool: "universal", machines: 2, crew: 4, type: "manual" },
        { id: "p1787298927652", name: "Ламинатор", pool: "universal", machines: 1, crew: 5, type: "machine" },
        { id: "p1787298939301", name: "Гидрорезка", pool: "dedicated", machines: 1, crew: 1, type: "machine" },
        { id: "p1787298947495", name: "Лазерная резка", pool: "dedicated", machines: 1, crew: 1, type: "machine" },
        { id: "p1787921989265", name: "Гибочник", pool: "universal", machines: 1, crew: 1, type: "manual" },
        { id: "p1787298978055", name: "Ролльформер", pool: "universal", machines: 1, crew: 4, type: "machine" },
        { id: "p1787298952912", name: "Штамповка", pool: "dedicated", machines: 1, crew: 1, type: "manual" },
        { id: "p1787298966902", name: "Сварочный пост", pool: "dedicated", machines: 2, crew: 1, type: "manual" },
        { id: "p1787298961438", name: "Покраска", pool: "dedicated", machines: 1, crew: 1, type: "manual" }
      ],
      products: [
        { id: "pr1", name: "Сотовые панели Кемерово", unit: "м²", scrap: 2, norms: { p1: 0.646, p5: 0.1 } },
        { id: "pr1787921270673", name: "Сэндвичи Кемерово", unit: "м²", scrap: 2, norms: { p2: 0.718, p1787298947495: 0.036 } },
        { id: "pr1787921272754", name: "Накрывные элементы", unit: "м²", scrap: 2, norms: { p1787298947495: 0.036, p1787921989265: 0.769 } },
        { id: "pr1787921285805", name: "Фальцевые картины", unit: "м²", scrap: 2, norms: { p1787298978055: 0.131 } },
        { id: "pr1787921287514", name: "Фронтон перемаркировка", unit: "м²", scrap: 2, norms: { p7: 0.08 } },
        { id: "pr1787921289146", name: "Кронштейны НКТ, ПКТ", unit: "шт", scrap: 2, norms: { p1787298952912: 0.003 } },
        { id: "pr1787921291139", name: "Инкерман белые панели", unit: "м²", scrap: 2, norms: { p1: 0.308, p6: 4.307, p1787298947495: 0.05, p1787298961438: 0.05, p1787921989265: 0.05 } },
        { id: "pr1787921297082", name: "Инкерман медные панели", unit: "м²", scrap: 2, norms: { p1: 0.269, p6: 2.165 } },
        { id: "pr1787921301923", name: "Стоечно-риг. система", unit: "м²", scrap: 2, norms: { p5: 2.153 } }
      ],
      months: ["09/26", "10/26"],
      plan: {
        pr1: [2014.65, 2014.65],
        pr1787921270673: [148.6, 148.6],
        pr1787921272754: [152.8, 152.8],
        pr1787921285805: [1150.75, 1150.75],
        pr1787921287514: [5373.54, 5373.54],
        pr1787921289146: [50466, 50466],
        pr1787921291139: [151.55, 151.55],
        pr1787921297082: [155.24, 155.24],
        pr1787921301923: [75, 75]
      },
      settings: {
        companyName: 'ООО "ЗСМК"',
        fNom: 168,
        fEff: 144,
        reserveOffPercent: 14.3,
        kVn: 1.05,
        brigadesCount: 3,
        brigadeSize: 6,
        maxOvertimePercent: 15,
        auxOtkPercent: 8,
        auxSetupPercent: 5,
        auxFixedPosts: 3,
        workDaysPerMonth: 21,
        shiftHoursStandard: 8,
        extendedShiftHours: 12,
        fNomExtended: 252,
        fEffExtended: 216
      },
      // ВОССТАНОВЛЕНЫ ВСЕ 13 ОРИГИНАЛЬНЫХ НОРМ С ПАРАМЕТРАМИ
      normConfigs: {
        "pr1___p1": { prodId: "pr1", profId: "p1", prodName: "Сотовые панели Кемерово", profName: "AluRanger", method: "stat", stat: { output: 50, workers: 3, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.646, updatedAt: "28.08.2026, 15:56" },
        "pr1787921270673___p1787298947495": { prodId: "pr1787921270673", profId: "p1787298947495", prodName: "Сэндвичи Кемерово", profName: "Лазерная резка", method: "stat", stat: { output: 300, workers: 1, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.036, updatedAt: "28.08.2026, 16:03" },
        "pr1787921270673___p2": { prodId: "pr1787921270673", profId: "p2", prodName: "Сэндвичи Кемерово", profName: "Холодная склейка", method: "stat", stat: { output: 75, workers: 5, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.718, updatedAt: "28.08.2026, 16:04" },
        "pr1787921285805___p1787298978055": { prodId: "pr1787921285805", profId: "p1787298978055", prodName: "Фальцевые картины", profName: "Ролльформер", method: "stat", stat: { output: 330, workers: 4, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.131, updatedAt: "28.08.2026, 16:05" },
        "pr1787921272754___p1787298947495": { prodId: "pr1787921272754", profId: "p1787298947495", prodName: "Накрывные элементы", profName: "Лазерная резка", method: "stat", stat: { output: 300, workers: 1, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.036, updatedAt: "28.08.2026, 16:05" },
        "pr1787921272754___p1787921989265": { prodId: "pr1787921272754", profId: "p1787921989265", prodName: "Накрывные элементы", profName: "Гибочник", method: "stat", stat: { output: 28, workers: 2, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.769, updatedAt: "28.08.2026, 16:06" },
        "pr1787921301923___p5": { prodId: "pr1787921301923", profId: "p5", prodName: "Стоечно-риг. система", profName: "Участок обработки алюминия", method: "stat", stat: { output: 30, workers: 6, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 2.153, updatedAt: "28.08.2026, 16:08" },
        "pr1787921291139___p1": { prodId: "pr1787921291139", profId: "p1", prodName: "Инкерман белые панели", profName: "AluRanger", method: "stat", stat: { output: 70, workers: 2, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.308, updatedAt: "28.08.2026, 16:09" },
        "pr1787921291139___p6": { prodId: "pr1787921291139", profId: "p6", prodName: "Инкерман белые панели", profName: "Сборочный пост", method: "stat", stat: { output: 10, workers: 4, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 4.307, updatedAt: "28.08.2026, 16:10" },
        "pr1787921297082___p1": { prodId: "pr1787921297082", profId: "p1", prodName: "Инкерман медные панели", profName: "AluRanger", method: "stat", stat: { output: 80, workers: 2, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.269, updatedAt: "28.08.2026, 16:12" },
        "pr1787921297082___p6": { prodId: "pr1787921297082", profId: "p6", prodName: "Инкерман медные панели", profName: "Сборочный пост", method: "stat", stat: { output: 11.7, workers: 5, shiftHours: 6, breaks: 40, kEff: 0.95 }, norm: 2.165, updatedAt: "28.08.2026, 16:13" },
        "pr1787921287514___p7": { prodId: "pr1787921287514", profId: "p7", prodName: "Фронтон перемаркировка", profName: "Подсобный рабочий", method: "stat", stat: { output: 537.5, workers: 4, shiftHours: 12, breaks: 40, kEff: 0.95 }, norm: 0.08, updatedAt: "28.08.2026, 16:19" },
        "pr1787921289146___p1787298952912": { prodId: "pr1787921289146", profId: "p1787298952912", prodName: "Кронштейны НКТ, ПКТ", profName: "Штамповка", method: "stat", stat: { output: 2000, workers: 1, shiftHours: 8, breaks: 40, kEff: 0.95 }, norm: 0.003, updatedAt: "28.08.2026, 16:21" }
      }
    },
    // ВОССТАНОВЛЕН СЦЕНАРИЙ №2
    "План 21.08.2026 без Ливадии": {
      professions: [
        { id: "p1", name: "AluRanger", pool: "universal", type: "machine", crew: 1, machines: 3 },
        { id: "p2", name: "Холодная склейка", pool: "universal", machines: 1, crew: 5, type: "machine" },
        { id: "p3", name: "Брикеты", pool: "universal", type: "machine", crew: 3, machines: 1 },
        { id: "p4", name: "Горячая склейка", pool: "universal", type: "machine", crew: 6, machines: 1 },
        { id: "p5", name: "Участок обработки алюминия", pool: "universal", crew: 6, type: "machine", machines: 1 },
        { id: "p6", name: "Сборочный пост", pool: "universal", machines: 4, crew: 4, type: "manual" },
        { id: "p7", name: "Подсобный рабочий", pool: "universal", machines: 2, crew: 4, type: "manual" },
        { id: "p1787298927652", name: "Ламинатор", pool: "universal", machines: 1, crew: 5, type: "machine" },
        { id: "p1787298939301", name: "Гидрорезка", pool: "dedicated", machines: 1, crew: 1, type: "machine" },
        { id: "p1787298947495", name: "Лазерная резка", pool: "dedicated", machines: 1, crew: 1, type: "machine" },
        { id: "p1787298952912", name: "Штамповка", pool: "dedicated", machines: 1, crew: 1, type: "manual" },
        { id: "p1787298961438", name: "Покраска", pool: "dedicated", machines: 1, crew: 1, type: "manual" },
        { id: "p1787298966902", name: "Сварочный пост", pool: "dedicated", machines: 2, crew: 1, type: "manual" },
        { id: "p1787298978055", name: "Ролльформер", pool: "universal", machines: 1, crew: 4, type: "machine" }
      ],
      products: [
        { id: "pr1", name: "Обработка и сборка Уникор", unit: "м²", scrap: 2, norms: { p1: 0.186, p6: 0.372 } },
        { id: "pr2", name: "Склеивание Уникор", unit: "м²", scrap: 2, norms: { p2: 0.399 } },
        { id: "pr3", name: "Сотовые брикеты", unit: "м²", scrap: 10, norms: { p3: 0.289 } },
        { id: "pr4", name: "Уникор сложная (Севастополь)", unit: "м²", scrap: 10, norms: { p1: 0.215, p6: 1.938, p7: 0.269, p1787298947495: 0.269, p1787298961438: 0.269, p1787298966902: 0.269 } },
        { id: "pr5", name: "Уникор Керамик", unit: "м²", scrap: 2, norms: { p2: 1.196, p6: 0.239, p1787298939301: 0.12 } },
        { id: "pr6", name: "Алюминиевые кассеты", unit: "м²", scrap: 2, norms: { p1: 0.108, p6: 0.215 } },
        { id: "pr7", name: "Сотовые ламели", unit: "м²", scrap: 2, norms: { p5: 0.054, p6: 1.5, p1787298961438: 0.054 } },
        { id: "pr8", name: "МКП Хардволл", unit: "м²", scrap: 2, norms: { p4: 0.174, p7: 0.174, p1787298952912: 0.007 } },
        { id: "pr9", name: "Металлокерамические зонты", unit: "м²", scrap: 4, norms: { p1787298927652: 0.359 } },
        { id: "pr10", name: "Фальцевые картины", unit: "м²", scrap: 2, norms: { p1787298978055: 0.036 } },
        { id: "pr11", name: "Светопрозрачные конструкции", unit: "м²", scrap: 2, norms: { p5: 1.175 } },
        { id: "pr12", name: "Фронтон перемаркировка", unit: "м²", scrap: 0, norms: { p7: 0.06 } },
        { id: "pr13", name: "Алюмокомпозит", unit: "м²", scrap: 2, norms: { p1: 0.108, p6: 0.215 } },
        { id: "pr14", name: "Фальц-опора + УЗЭ", unit: "шт", scrap: 2, norms: { p1787298952912: 0.007 } },
        { id: "pr15", name: "Пластина снегозадержания", unit: "шт", scrap: 2, norms: { p6: 0.013, p1787298947495: 0.006 } }
      ],
      months: ["08/26","09/26","10/26","11/26","12/26","01/27","02/27","03/27","04/27","05/27","06/27","07/27","08/27","09/27","10/27","11/27","12/27"],
      plan: {
        pr1: [1917,1300,2992,5377,5378,5378,5378,1628,1628,2162,2162,783,250,3825,3825,3825,3825],
        pr2: [0,0,1627,5377,5378,5378,5378,1628,1628,2162,2162,783,250,3825,3825,3825,3825],
        pr3: [0,0,2127,6377,6212,6212,6212,1628,1628,2162,2162,783,250,3825,3825,3825,3825],
        pr4: [0,809,1000,1809,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr5: [0,0,500,1000,833,833,833,0,0,0,0,0,0,0,0,0,0],
        pr6: [0,0,0,0,0,0,0,0,0,0,0,0,0,2125,2125,2125,2125],
        pr7: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr8: [584,263,4119,5424,3330,0,0,0,0,0,0,0,0,0,0,0,0],
        pr9: [0,500,500,500,150,300,300,150,280,300,370,300,70,0,0,0,0],
        pr10: [3311,0,0,0,4717,10167,10167,10167,10167,10167,10500,3750,11254,11254,7504,7504,0],
        pr11: [500,600,550,650,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr12: [0,2889,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr13: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr14: [4865,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr15: [314,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      settings: {
        companyName: 'ООО "ЗСМК"',
        fNom: 168, fEff: 144, reserveOffPercent: 14.3, kVn: 1.05,
        brigadesCount: 3, brigadeSize: 6, maxOvertimePercent: 15,
        auxOtkPercent: 8, auxSetupPercent: 5, auxFixedPosts: 2,
        workDaysPerMonth: 21, shiftHoursStandard: 8, extendedShiftHours: 12,
        fNomExtended: 252, fEffExtended: 216
      },
      normConfigs: {}
    },
    // ВОССТАНОВЛЕН СЦЕНАРИЙ №3
    "План 21.08.2026": {
      professions: [
        { id: "p1", name: "AluRanger", pool: "universal", type: "machine", crew: 3, machines: 3 },
        { id: "p2", name: "Холодная склейка", pool: "universal", machines: 1, crew: 5, type: "machine" },
        { id: "p3", name: "Брикеты", pool: "universal", type: "machine", crew: 3, machines: 1 },
        { id: "p4", name: "Горячая склейка", pool: "universal", type: "machine", crew: 6, machines: 1 },
        { id: "p5", name: "Участок обработки алюминия", pool: "universal", crew: 6, type: "machine", machines: 1 },
        { id: "p6", name: "Сборочный пост", pool: "universal", machines: 4, crew: 3, type: "manual" },
        { id: "p7", name: "Подсобный рабочий", pool: "universal", machines: 2, crew: 4, type: "manual" },
        { id: "p1787298927652", name: "Ламинатор", pool: "universal", machines: 1, crew: 5, type: "machine" },
        { id: "p1787298939301", name: "Гидрорезка", pool: "dedicated", machines: 1, crew: 1, type: "machine" },
        { id: "p1787298947495", name: "Лазерная резка", pool: "dedicated", machines: 1, crew: 1, type: "machine" },
        { id: "p1787298952912", name: "Штамповка", pool: "dedicated", machines: 1, crew: 1, type: "manual" },
        { id: "p1787298961438", name: "Покраска", pool: "dedicated", machines: 1, crew: 1, type: "manual" },
        { id: "p1787298966902", name: "Сварочный пост", pool: "dedicated", machines: 2, crew: 1, type: "manual" },
        { id: "p1787298978055", name: "Ролльформер", pool: "universal", machines: 1, crew: 4, type: "machine" }
      ],
      products: [
        { id: "pr1", name: "Обработка и сборка Уникор", unit: "м²", scrap: 2, norms: { p1: 1.615, p6: 0.372 } },
        { id: "pr2", name: "Склеивание Уникор", unit: "м²", scrap: 2, norms: { p2: 0.399 } },
        { id: "pr3", name: "Сотовые брикеты", unit: "м²", scrap: 10, norms: { p3: 0.289 } },
        { id: "pr4", name: "Уникор сложная (Севастополь)", unit: "м²", scrap: 10, norms: { p1: 0.215, p6: 1.938, p7: 0.269, p1787298947495: 0.269, p1787298961438: 0.269, p1787298966902: 0.269 } },
        { id: "pr5", name: "Уникор Керамик", unit: "м²", scrap: 2, norms: { p2: 1.196, p6: 0.239, p1787298939301: 0.12 } },
        { id: "pr6", name: "Алюминиевые кассеты", unit: "м²", scrap: 2, norms: { p1: 0.108, p6: 0.215 } },
        { id: "pr7", name: "Сотовые ламели", unit: "м²", scrap: 2, norms: { p5: 0.054, p6: 2.153, p1787298961438: 0.054 } },
        { id: "pr8", name: "МКП Хардволл", unit: "м²", scrap: 2, norms: { p4: 0.174, p7: 0.174, p1787298952912: 0.007 } },
        { id: "pr9", name: "Металлокерамические зонты", unit: "м²", scrap: 4, norms: { p1787298927652: 0.359 } },
        { id: "pr10", name: "Фальцевые картины", unit: "м²", scrap: 2, norms: { p1787298978055: 0.036 } },
        { id: "pr11", name: "Светопрозрачные конструкции", unit: "м²", scrap: 2, norms: { p5: 1.175 } },
        { id: "pr12", name: "Фронтон перемаркировка", unit: "м²", scrap: 0, norms: { p7: 0.06 } },
        { id: "pr13", name: "Алюмокомпозит", unit: "м²", scrap: 2, norms: { p1: 0.108, p6: 0.215 } },
        { id: "pr14", name: "Фальц-опора + УЗЭ", unit: "шт", scrap: 2, norms: { p1787298952912: 0.007 } },
        { id: "pr15", name: "Пластина снегозадержания", unit: "шт", scrap: 2, norms: { p6: 0.013, p1787298947495: 0.006 } }
      ],
      months: ["08/26","09/26","10/26","11/26","12/26","01/27","02/27","03/27","04/27","05/27","06/27","07/27","08/27","09/27","10/27","11/27","12/27"],
      plan: {
        pr1: [1917,1300,2992,5377,5378,5378,5378,1628,1628,2162,2162,783,250,3825,3825,3825,3825],
        pr2: [0,0,1627,5377,5378,5378,5378,1628,1628,2162,2162,783,250,3825,3825,3825,3825],
        pr3: [0,0,2127,6377,6212,6212,6212,1628,1628,2162,2162,783,250,3825,3825,3825,3825],
        pr4: [0,809,1000,1809,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr5: [0,0,500,1000,833,833,833,0,0,0,0,0,0,0,0,0,0],
        pr6: [0,0,0,0,0,0,0,0,0,0,0,0,0,2125,2125,2125,2125],
        pr7: [0,388,388,388,388,0,0,0,0,0,0,0,0,0,0,0,0],
        pr8: [584,263,4119,5424,3330,0,0,0,0,0,0,0,0,0,0,0],
        pr9: [0,500,500,500,150,300,300,150,280,300,370,300,70,0,0,0,0],
        pr10: [3311,0,0,0,4717,10167,10167,10167,10167,10167,10500,3750,11254,11254,7504,7504,0],
        pr11: [500,2513,2463,2563,1913,0,0,0,0,0,0,0,0,0,0,0,0],
        pr12: [0,2889,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr13: [0,4750,4750,4750,4750,0,0,0,0,0,0,0,0,0,0,0],
        pr14: [4865,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        pr15: [314,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      },
      settings: {
        companyName: 'ООО "ЗСМК"',
        fNom: 168, fEff: 144, reserveOffPercent: 14.3, kVn: 1.05,
        brigadesCount: 3, brigadeSize: 6, maxOvertimePercent: 15,
        auxOtkPercent: 8, auxSetupPercent: 5, auxFixedPosts: 2,
        workDaysPerMonth: 21, shiftHoursStandard: 8, extendedShiftHours: 12,
        fNomExtended: 252, fEffExtended: 216
      },
      normConfigs: {}
    }
  }
};
