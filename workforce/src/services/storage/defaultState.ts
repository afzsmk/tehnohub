// src/services/storage/defaultState.ts
import { AppState } from '../../types';

export const PRELOADED_STATE: AppState = {
  currentScenario: "План сент-окт 2026",
  scenarios: {
    "План сент-окт 2026": {
      professions: [
        { id: "p1", name: "AluRanger", pool: "universal", type: "machine", crew: 3, machines: 3 },
        { id: "p2", name: "Холодная склейка", pool: "universal", machines: 1, crew: 5, type: "machine" },
        { id: "p3", name: "Брикеты", pool: "universal", type: "machine", crew: 3 },
        { id: "p4", name: "Горячая склейка", pool: "universal", type: "machine", crew: 6 },
        { id: "p5", name: "Участок обработки алюминия", pool: "universal", crew: 6, type: "machine" },
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
      normConfigs: {}
    }
  }
};