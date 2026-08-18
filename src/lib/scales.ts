/**
 * Scale catalogue — shared by the server (round generation, leaderboards)
 * and the client (rendering). `key` is the stable identifier stored in the
 * database, so labels can be reworded later without losing statistics.
 */

export type Category = "general" | "analytics";
export type Lang = "ua" | "en";

export interface Scale {
  key: string;
  category: Category;
  l: Record<Lang, string>;
  r: Record<Lang, string>;
}

export const SCALES: Scale[] = [
  // ---------------- General & fun ----------------
  { key: "risky_safe",        category: "general", l: { ua: "Ризиковано", en: "Risky" },               r: { ua: "Безпечно", en: "Safe" } },
  { key: "funny_cringe",      category: "general", l: { ua: "Смішно", en: "Funny" },                   r: { ua: "Крінжово", en: "Cringe" } },
  { key: "urgent_canwait",    category: "general", l: { ua: "Терміново", en: "Urgent" },               r: { ua: "Може почекати", en: "Can wait" } },
  { key: "genius_nonsense",   category: "general", l: { ua: "Геніально", en: "Genius" },               r: { ua: "Повна дурня", en: "Total nonsense" } },
  { key: "expensive_cheap",   category: "general", l: { ua: "Дуже дорого", en: "Very expensive" },     r: { ua: "Дуже дешево", en: "Very cheap" } },
  { key: "useful_useless",    category: "general", l: { ua: "Корисно", en: "Useful" },                 r: { ua: "Марно", en: "Useless" } },
  { key: "over_underrated",   category: "general", l: { ua: "Переоцінено", en: "Overrated" },          r: { ua: "Недооцінено", en: "Underrated" } },
  { key: "hot_cold",          category: "general", l: { ua: "Гаряче", en: "Hot" },                     r: { ua: "Холодне", en: "Cold" } },
  { key: "normal_weird",      category: "general", l: { ua: "Звичайне", en: "Normal" },                r: { ua: "Дивне", en: "Weird" } },
  { key: "hard_easy",         category: "general", l: { ua: "Складно", en: "Hard" },                   r: { ua: "Легко", en: "Easy" } },
  { key: "intro_extrovert",   category: "general", l: { ua: "Інтроверт", en: "Introvert" },            r: { ua: "Екстраверт", en: "Extrovert" } },
  { key: "movie_under_hyped", category: "general", l: { ua: "Недооцінений фільм", en: "Underrated movie" }, r: { ua: "Хайповий фільм", en: "Hyped movie" } },

  // ---------------- Analytics team ----------------
  { key: "significant_noise", category: "analytics", l: { ua: "Статистично значуще", en: "Statistically significant" }, r: { ua: "Просто шум", en: "Just noise" } },
  { key: "dashboard_export",  category: "analytics", l: { ua: "Дашборд", en: "Dashboard" },            r: { ua: "Ручний експорт", en: "Manual export" } },
  { key: "signal_noise",      category: "analytics", l: { ua: "Сигнал", en: "Signal" },                r: { ua: "Шум", en: "Noise" } },
  { key: "corr_causation",    category: "analytics", l: { ua: "Кореляція", en: "Correlation" },        r: { ua: "Причинність", en: "Causation" } },
  { key: "clean_dirty_data",  category: "analytics", l: { ua: "Чисті дані", en: "Clean data" },        r: { ua: "Брудні дані", en: "Dirty data" } },
  { key: "ab_test_obvious",   category: "analytics", l: { ua: "Варто A/B-тестити", en: "Worth A/B testing" }, r: { ua: "І так очевидно", en: "Obvious already" } },
  { key: "p005_p05",          category: "analytics", l: { ua: "p < 0.05", en: "p < 0.05" },            r: { ua: "p = 0.5", en: "p = 0.5" } },
  { key: "datadriven_gut",    category: "analytics", l: { ua: "Data-driven", en: "Data-driven" },      r: { ua: "На відчуттях", en: "Gut feeling" } },
  { key: "more_enough_data",  category: "analytics", l: { ua: "Треба ще даних", en: "Need more data" }, r: { ua: "Даних достатньо", en: "Enough data" } },
  { key: "real_vanity",       category: "analytics", l: { ua: "Справжня метрика", en: "Real metric" }, r: { ua: "Vanity-метрика", en: "Vanity metric" } },
  { key: "realtime_quarter",  category: "analytics", l: { ua: "Реал-тайм", en: "Real-time" },          r: { ua: "Раз на квартал", en: "Once a quarter" } },
  { key: "automate_manual",   category: "analytics", l: { ua: "Автоматизувати", en: "Automate" },      r: { ua: "Зробити руками", en: "Do it manually" } },
  { key: "funnel_leak_ok",    category: "analytics", l: { ua: "Витік у воронці", en: "Funnel leak" },  r: { ua: "Здорова воронка", en: "Healthy funnel" } },
  { key: "outlier_typical",   category: "analytics", l: { ua: "Викид (outlier)", en: "Outlier" },      r: { ua: "Типове значення", en: "Typical value" } },
];

const BY_KEY = new Map(SCALES.map((s) => [s.key, s]));

export function scaleByKey(key: string): Scale | undefined {
  return BY_KEY.get(key);
}

export function scalesForCategories(categories: string[]): Scale[] {
  const wanted = new Set(categories);
  const pool = SCALES.filter((s) => wanted.has(s.category));
  return pool.length > 0 ? pool : SCALES;
}

/** Labels for a scale in a given language, with a graceful fallback. */
export function scaleLabels(
  key: string,
  lang: Lang,
  fallback?: { left: string; right: string }
): { left: string; right: string } {
  const s = BY_KEY.get(key);
  if (s) return { left: s.l[lang], right: s.r[lang] };
  return fallback ?? { left: "?", right: "?" };
}
