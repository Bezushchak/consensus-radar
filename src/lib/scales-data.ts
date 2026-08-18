/**
 * The scale catalogue — every polar pair the game can deal.
 *
 * This file is the authoring source. `supabase/scales-seed.sql` is generated
 * from it (`npm run scales:sql`) and loaded into the `public.scales` table,
 * which is what a running game actually reads: that way pairs can be added or
 * reworded from the Supabase dashboard without a deploy. This list stays in
 * the code as the fallback for when the table is empty or unreachable.
 *
 * `key` is the stable identifier stored on every round and every stat row, so
 * labels can be reworded later without losing history. Never reuse a key for
 * a different meaning.
 *
 * Rows are [key, UA left, UA right, EN left, EN right].
 */

import { filterByCategories, type Category, type Scale } from "./scales";

type Row = readonly [string, string, string, string, string];

// ---------------------------------------------------------------------
// General & fun — the everyday Wavelength-style pairs.
// ---------------------------------------------------------------------
const GENERAL: readonly Row[] = [
  // --- core opposites ---
  ["risky_safe", "Ризиковано", "Безпечно", "Risky", "Safe"],
  ["hot_cold", "Гаряче", "Холодне", "Hot", "Cold"],
  ["hard_easy", "Складно", "Легко", "Hard", "Easy"],
  ["useful_useless", "Корисно", "Марно", "Useful", "Useless"],
  ["funny_cringe", "Смішно", "Крінжово", "Funny", "Cringe"],
  ["genius_nonsense", "Геніально", "Повна дурня", "Genius", "Total nonsense"],
  ["urgent_canwait", "Терміново", "Може почекати", "Urgent", "Can wait"],
  ["expensive_cheap", "Дуже дорого", "Дуже дешево", "Very expensive", "Very cheap"],
  ["over_underrated", "Переоцінено", "Недооцінено", "Overrated", "Underrated"],
  ["normal_weird", "Звичайне", "Дивне", "Normal", "Weird"],
  ["intro_extrovert", "Інтроверт", "Екстраверт", "Introvert", "Extrovert"],
  ["movie_under_hyped", "Недооцінений фільм", "Хайповий фільм", "Underrated movie", "Hyped movie"],
  ["good_evil", "Добро", "Зло", "Good", "Evil"],
  ["loud_quiet", "Гучно", "Тихо", "Loud", "Quiet"],
  ["big_small", "Велике", "Маленьке", "Big", "Small"],
  ["fast_slow", "Швидко", "Повільно", "Fast", "Slow"],
  ["old_new", "Старе", "Нове", "Old", "New"],
  ["clean_dirty", "Чисте", "Брудне", "Clean", "Dirty"],
  ["soft_solid", "М'яке", "Тверде", "Soft", "Hard"],
  ["bright_dark", "Світле", "Темне", "Bright", "Dark"],
  ["wet_dry", "Мокре", "Сухе", "Wet", "Dry"],
  ["heavy_light", "Важке", "Легке", "Heavy", "Light"],
  ["round_sharp", "Кругле", "Гостре", "Round", "Sharp"],
  ["smooth_rough", "Гладке", "Шорстке", "Smooth", "Rough"],
  ["simple_complex", "Просте", "Складне", "Simple", "Complex"],
  ["beautiful_ugly", "Красиве", "Потворне", "Beautiful", "Ugly"],
  ["cute_scary", "Миле", "Страшне", "Cute", "Scary"],
  ["serious_silly", "Серйозно", "Несерйозно", "Serious", "Silly"],
  ["formal_casual", "Формально", "Неформально", "Formal", "Casual"],
  ["polite_rude", "Ввічливо", "Грубо", "Polite", "Rude"],
  ["brave_cowardly", "Смілово", "Боязко", "Brave", "Cowardly"],
  ["lucky_unlucky", "Щасливчик", "Невдаха", "Lucky", "Unlucky"],
  ["boring_exciting", "Нудно", "Захопливо", "Boring", "Exciting"],
  ["calm_chaotic", "Спокійно", "Хаотично", "Calm", "Chaotic"],
  ["relaxing_stressful", "Розслабляє", "Стресує", "Relaxing", "Stressful"],
  ["comfy_uncomfy", "Комфортно", "Незручно", "Comfy", "Uncomfortable"],
  ["cozy_sterile", "Затишно", "Стерильно", "Cosy", "Sterile"],
  ["friendly_intimidating", "Дружньо", "Лякає", "Friendly", "Intimidating"],
  ["wholesome_dark", "Мило й тепло", "Темно", "Wholesome", "Dark"],
  ["tidy_messy", "Порядок", "Хаос", "Tidy", "Messy"],

  // --- food & drink ---
  ["sweet_salty", "Солодке", "Солоне", "Sweet", "Salty"],
  ["bitter_sweet", "Гірке", "Солодке", "Bitter", "Sweet"],
  ["spicy_bland", "Гостре", "Пресне", "Spicy", "Bland"],
  ["crunchy_soggy", "Хрустке", "Розмокле", "Crunchy", "Soggy"],
  ["healthy_junk", "Здорова їжа", "Фастфуд", "Healthy food", "Junk food"],
  ["breakfast_dinner", "Сніданок", "Вечеря", "Breakfast food", "Dinner food"],
  ["snack_meal", "Перекус", "Повноцінний обід", "A snack", "A full meal"],
  ["drink_dessert", "Напій", "Десерт", "A drink", "A dessert"],
  ["sandwich_not", "Це сендвіч", "Це не сендвіч", "That's a sandwich", "That's not a sandwich"],
  ["soup_not", "Це суп", "Це не суп", "That's a soup", "That's not a soup"],
  ["dish_not", "Це страва", "Це просто набір продуктів", "That's a dish", "That's just ingredients"],
  ["tea_coffee", "Чай", "Кава", "Tea", "Coffee"],
  ["cook_order", "Готувати вдома", "Замовити доставку", "Cook at home", "Order in"],
  ["underrated_food", "Недооцінена страва", "Переоцінена страва", "Underrated food", "Overrated food"],

  // --- everyday life & preferences ---
  ["city_village", "Місто", "Село", "City", "Countryside"],
  ["morning_night", "Ранкова людина", "Нічна людина", "Morning person", "Night owl"],
  ["summer_winter", "Літо", "Зима", "Summer", "Winter"],
  ["beach_mountains", "Пляж", "Гори", "Beach", "Mountains"],
  ["cat_dog", "Кіт", "Пес", "Cat", "Dog"],
  ["car_transit", "Своє авто", "Громадський транспорт", "Own car", "Public transport"],
  ["plan_improvise", "Планувати", "Імпровізувати", "Plan it", "Improvise"],
  ["save_spend", "Відкладати", "Витрачати", "Save it", "Spend it"],
  ["rent_buy", "Орендувати", "Купувати", "Rent", "Buy"],
  ["minimal_maximal", "Мінімалізм", "Максималізм", "Minimalism", "Maximalism"],
  ["early_late", "Приходити раніше", "Спізнюватися", "Show up early", "Show up late"],
  ["text_call", "Написати", "Подзвонити", "Text", "Call"],
  ["email_meeting", "Лист", "Зустріч", "An email", "A meeting"],
  ["remote_office", "Віддалено", "В офісі", "Remote", "In the office"],
  ["weekday_weekend", "Будні", "Вихідні", "Weekday", "Weekend"],
  ["shower_am_pm", "Душ зранку", "Душ ввечері", "Morning shower", "Evening shower"],
  ["socks_barefoot", "Шкарпетки вдома", "Босоніж", "Socks indoors", "Barefoot"],
  ["window_aisle", "Місце біля вікна", "Біля проходу", "Window seat", "Aisle seat"],
  ["carryon_suitcase", "Тільки ручна поклажа", "Велика валіза", "Carry-on only", "Big suitcase"],
  ["map_wander", "За маршрутом", "Куди очі дивляться", "Follow the map", "Just wander"],
  ["socks_sandals", "Це нормально", "Це злочин проти моди", "Perfectly fine", "A fashion crime"],
  ["hoard_declutter", "Зберігати все", "Викидати", "Keep everything", "Throw it out"],
  ["list_memory", "Записати в список", "Тримати в голові", "Make a list", "Keep it in your head"],
  ["handwrite_type", "Від руки", "Друкувати", "Handwrite", "Type"],
  ["paper_digital", "Папір", "Цифра", "Paper", "Digital"],

  // --- culture & media ---
  ["book_movie", "Книга", "Фільм", "The book", "The movie"],
  ["cinema_home", "Кінотеатр", "Дома на дивані", "Cinema", "Home couch"],
  ["binge_weekly", "Залпом", "По серії на тиждень", "Binge it", "One episode a week"],
  ["spoilers_ok_no", "Спойлери — це ок", "Спойлери — злочин", "Spoilers are fine", "Spoilers are a crime"],
  ["classic_trend", "Класика", "Тренд", "A classic", "A trend"],
  ["timeless_dated", "Не старіє", "Застаріло", "Timeless", "Dated"],
  ["art_not_art", "Це мистецтво", "Це не мистецтво", "This is art", "This is not art"],
  ["mainstream_indie", "Мейнстрим", "Інді", "Mainstream", "Indie"],
  ["viral_niche", "Вірусне", "Нішеве", "Viral", "Niche"],
  ["meme_alive_dead", "Живий мем", "Мертвий мем", "Living meme", "Dead meme"],
  ["nostalgic_futuristic", "Ностальгічно", "Футуристично", "Nostalgic", "Futuristic"],
  ["retro_modern", "Ретро", "Сучасне", "Retro", "Modern"],
  ["analog_digital", "Аналогове", "Цифрове", "Analogue", "Digital"],
  ["handmade_massprod", "Ручна робота", "Масове виробництво", "Handmade", "Mass produced"],
  ["ad_content", "Реклама", "Контент", "An ad", "Content"],
  ["news_gossip", "Новина", "Плітка", "News", "Gossip"],
  ["myth_fact", "Міф", "Факт", "Myth", "Fact"],
  ["conspiracy_plausible", "Теорія змови", "Схоже на правду", "Conspiracy theory", "Plausible"],
  ["superstition_science", "Забобон", "Наука", "Superstition", "Science"],
  ["guilty_proud", "Соромно, але люблю", "Гордо люблю", "Guilty pleasure", "Proud favourite"],

  // --- judgements & social calls ---
  ["talent_luck", "Талант", "Щастя", "Talent", "Luck"],
  ["skill_chance_game", "Гра на вміння", "Гра на удачу", "Game of skill", "Game of luck"],
  ["sport_not_sport", "Це спорт", "Це не спорт", "That's a sport", "That's not a sport"],
  ["toy_collectible", "Іграшка", "Колекційна річ", "A toy", "A collectible"],
  ["tool_weapon", "Інструмент", "Зброя", "A tool", "A weapon"],
  ["pet_wild", "Домашня тварина", "Дика тварина", "A pet", "A wild animal"],
  ["friend_acquaintance", "Друг", "Знайомий", "A friend", "An acquaintance"],
  ["hobby_job", "Хобі", "Робота", "A hobby", "A job"],
  ["work_play", "Робота", "Розвага", "Work", "Play"],
  ["compliment_insult", "Комплімент", "Образа", "A compliment", "An insult"],
  ["flirting_friendly", "Флірт", "Просто дружньо", "Flirting", "Just being friendly"],
  ["confident_arrogant", "Впевнено", "Зарозуміло", "Confident", "Arrogant"],
  ["honest_harsh", "Відкрито", "Жорстко", "Honest", "Harsh"],
  ["brave_reckless", "Смілива ідея", "Безрозсудна ідея", "Brave idea", "Reckless idea"],
  ["kind_naive", "Добрий", "Наївний", "Kind", "Naive"],
  ["clever_smartass", "Розумно", "Вискочка", "Clever", "Smart-ass"],
  ["leader_boss", "Лідер", "Начальник", "A leader", "A boss"],
  ["rule_suggestion", "Правило", "Порада", "A rule", "A suggestion"],
  ["tradition_habit", "Традиція", "Просто звичка", "Tradition", "Just a habit"],
  ["legal_illegal", "Законно", "Незаконно", "Legal", "Illegal"],
  ["ethical_shady", "Етично", "Сумнівно", "Ethical", "Shady"],
  ["forgivable_not", "Можна пробачити", "Не можна пробачити", "Forgivable", "Unforgivable"],
  ["crime_prank", "Злочин", "Жарт", "A crime", "A prank"],
  ["petty_serious", "Дрібниця", "Серйозна справа", "Petty", "Serious business"],
  ["red_green_flag", "Red flag", "Green flag", "Red flag", "Green flag"],
  ["dealbreaker_quirk", "Ділбрейкер", "Просто дивинка", "Dealbreaker", "Just a quirk"],
  ["mature_childish", "Доросло", "По-дитячому", "Mature", "Childish"],
  ["for_adults_kids", "Для дорослих", "Для дітей", "For adults", "For kids"],
  ["worth_it_ripoff", "Варте грошей", "Здирництво", "Worth the money", "A rip-off"],
  ["investment_waste", "Інвестиція", "Витрата", "An investment", "A waste"],
  ["need_want", "Потрібно", "Хочеться", "A need", "A want"],
  ["essential_optional", "Обов'язкове", "Необов'язкове", "Essential", "Optional"],
  ["luxury_basic", "Люкс", "База", "Luxury", "Basic"],

  // --- character & attitude ---
  ["easy_learn_hard_master", "Легко навчитися", "Важко опанувати", "Easy to learn", "Hard to master"],
  ["beginner_expert", "Для новачка", "Для експерта", "Beginner", "Expert"],
  ["overqualified_under", "Надкваліфікований", "Недокваліфікований", "Overqualified", "Underqualified"],
  ["natural_practised", "Від природи", "Натреновано", "Natural talent", "Practised"],
  ["team_solo", "Командна гра", "Соло", "Team game", "Solo"],
  ["cooperate_compete", "Співпраця", "Конкуренція", "Cooperate", "Compete"],
  ["winning_fun", "Головне перемога", "Головне весело", "Winning matters", "Fun matters"],
  ["process_result", "Процес", "Результат", "The process", "The result"],
  ["quality_speed", "Якість", "Швидкість", "Quality", "Speed"],
  ["perfect_done", "Ідеально", "Просто зроблено", "Perfect", "Just done"],
  ["details_bigpicture", "Деталі", "Загальна картина", "The details", "The big picture"],
  ["rules_vibes", "За правилами", "На відчуттях", "By the rules", "By vibes"],
  ["logic_emotion", "Логіка", "Емоції", "Logic", "Emotion"],
  ["head_heart", "Голова", "Серце", "Head", "Heart"],
  ["optimist_pessimist", "Оптиміст", "Песиміст", "Optimist", "Pessimist"],
  ["realist_dreamer", "Реаліст", "Мрійник", "Realist", "Dreamer"],
  ["patient_impatient", "Терплячий", "Нетерплячий", "Patient", "Impatient"],
  ["stubborn_flexible", "Впертий", "Гнучкий", "Stubborn", "Flexible"],
  ["loyal_fickle", "Вірний", "Непостійний", "Loyal", "Fickle"],
  ["generous_stingy", "Щедрий", "Скупий", "Generous", "Stingy"],
  ["humble_showoff", "Скромний", "Хвалько", "Humble", "Show-off"],
  ["lazy_workaholic", "Лінивий", "Трудоголік", "Lazy", "Workaholic"],
  ["spontaneous_scheduled", "Спонтанно", "За розписом", "Spontaneous", "Scheduled"],
  ["risktaker_cautious", "Ризикун", "Обережний", "Risk-taker", "Cautious"],
  ["leads_follows", "Веде за собою", "Йде за іншими", "Leads", "Follows"],
  ["talker_listener", "Говорить", "Слухає", "Talker", "Listener"],
  ["party_home", "Вечірка", "Вечір дома", "Party", "Night in"],
  ["smalltalk_deep", "Смолток", "Глибокі теми", "Small talk", "Deep talk"],
  ["dance_wallflower", "Танцювати", "Стояти біля стіни", "Dance", "Hold up the wall"],
  ["music_loud_silence", "Музика на повну", "Повна тиша", "Music blasting", "Total silence"],

  // --- tech & modern habits ---
  ["early_late_adopter", "Ранній адоптер", "Переходить останнім", "Early adopter", "Late adopter"],
  ["gadget_lover_sceptic", "Любить гаджети", "Не довіряє технологіям", "Gadget lover", "Tech sceptic"],
  ["android_ios", "Android", "iOS", "Android", "iOS"],
  ["pc_console", "ПК", "Консоль", "PC", "Console"],
  ["mac_windows", "Mac", "Windows", "Mac", "Windows"],
  ["light_dark_mode", "Світла тема", "Темна тема", "Light mode", "Dark mode"],
  ["tabs_spaces", "Табуляція", "Пробіли", "Tabs", "Spaces"],
  ["emoji_plaintext", "Емодзі", "Сухий текст", "Emoji", "Plain text"],
  ["voice_text", "Голосове", "Текстом", "Voice note", "Text message"],
  ["camera_on_off", "Камера ввімкнена", "Камера вимкнена", "Camera on", "Camera off"],
  ["notifications_all_muted", "Усі нотифікації", "Усе вимкнено", "All notifications on", "Everything muted"],
  ["inbox_zero_thousand", "Inbox zero", "Тисяча непрочитаних", "Inbox zero", "A thousand unread"],
  ["one_tab_hundred", "Одна вкладка", "Сто вкладок", "One tab", "A hundred tabs"],
  ["bookmark_research", "Зберегти в закладки", "Шукати заново", "Bookmark it", "Search again"],
  ["reads_terms_never", "Читає умови", "Ніколи не читає", "Reads the terms", "Never reads them"],
  ["passwordmanager_notebook", "Менеджер паролів", "Записник на столі", "Password manager", "A notebook"],
  ["backup_yolo", "Робить бекапи", "YOLO", "Makes backups", "YOLO"],
  ["update_now_later", "Оновити зараз", "Нагадати пізніше", "Update now", "Remind me later"],
] as const;

// ---------------------------------------------------------------------
// Analytics team — same game, in-joke edition.
// ---------------------------------------------------------------------
const ANALYTICS: readonly Row[] = [
  // --- statistics ---
  ["significant_noise", "Статистично значуще", "Просто шум", "Statistically significant", "Just noise"],
  ["signal_noise", "Сигнал", "Шум", "Signal", "Noise"],
  ["corr_causation", "Кореляція", "Причинність", "Correlation", "Causation"],
  ["p005_p05", "p < 0.05", "p = 0.5", "p < 0.05", "p = 0.5"],
  ["mean_median", "Середнє", "Медіана", "Mean", "Median"],
  ["sample_population", "Вибірка", "Уся сукупність", "Sample", "Population"],
  ["outlier_typical", "Викид", "Типове значення", "Outlier", "Typical value"],
  ["underpowered_powered", "Замала потужність", "Достатня потужність", "Underpowered", "Well-powered"],
  ["statsig_practical", "Статистично значуще", "Практично значуще", "Statistically significant", "Practically significant"],
  ["bias_variance", "Зсув", "Розсіювання", "Bias", "Variance"],
  ["simpson_straight", "Парадокс Сімпсона", "Усе прямолінійно", "Simpson's paradox", "Straightforward"],
  ["survivorship_full", "Помилка виживання", "Повна картина", "Survivorship bias", "Full picture"],
  ["selection_random", "Зсув відбору", "Випадкова вибірка", "Selection bias", "Random sample"],
  ["hypothesis_fishing", "Гіпотеза", "Рибалка по даних", "A hypothesis", "Fishing for results"],
  ["phacking_honest", "p-hacking", "Чесний аналіз", "p-hacking", "Honest analysis"],

  // --- experiments ---
  ["ab_test_obvious", "Варто A/B-тестити", "І так очевидно", "Worth A/B testing", "Obvious already"],
  ["experiment_rollout", "Експеримент", "Повний ролаут", "An experiment", "A full rollout"],
  ["holdout_everyone", "Холдаут-група", "Усі юзери", "Holdout group", "Everyone"],
  ["srm_balanced", "Перекіс у групах", "Групи збалансовані", "Sample ratio mismatch", "Balanced groups"],
  ["peeking_waiting", "Підглядати в тест", "Дочекатися кінця", "Peeking", "Waiting it out"],
  ["tiny_huge_effect", "Мікроскопічний ефект", "Величезний ефект", "Tiny effect", "Huge effect"],
  ["ship_iterate", "Запускати", "Ще покрутити", "Ship it", "Keep tuning"],
  ["short_long_term", "Короткий термін", "Довгий термін", "Short term", "Long term"],

  // --- data quality & pipelines ---
  ["clean_dirty_data", "Чисті дані", "Брудні дані", "Clean data", "Dirty data"],
  ["more_enough_data", "Треба ще даних", "Даних достатньо", "Need more data", "Enough data"],
  ["bug_or_behaviour", "Це баг у трекінгу", "Це реальна поведінка", "Tracking bug", "Real user behaviour"],
  ["tracking_broken_fine", "Трекінг зламався", "Трекінг у нормі", "Tracking is broken", "Tracking is fine"],
  ["event_missing_ok", "Івент не надсилається", "Усе логується", "Event is missing", "Everything logs"],
  ["schema_drift_stable", "Схема поплила", "Схема стабільна", "Schema drift", "Stable schema"],
  ["etl_late_ontime", "Пайплайн запізнився", "Прийшло вчасно", "Pipeline is late", "On time"],
  ["backfill_forward", "Перезалити історію", "Тільки з цього дня", "Backfill history", "Only going forward"],
  ["batch_streaming", "Батч", "Стрімінг", "Batch", "Streaming"],
  ["warehouse_lake", "Сховище", "Дата-лейк", "Warehouse", "Data lake"],
  ["realtime_quarter", "Реал-тайм", "Раз на квартал", "Real-time", "Once a quarter"],
  ["automate_manual", "Автоматизувати", "Зробити руками", "Automate", "Do it manually"],
  ["dashboard_export", "Дашборд", "Ручний експорт", "Dashboard", "Manual export"],
  ["sql_spreadsheet", "SQL", "Табличка в екселі", "SQL", "A spreadsheet"],
  ["notebook_production", "Ноутбук на коліні", "Прод", "A notebook", "Production"],
  ["prototype_pipeline", "Прототип", "Продакшн-пайплайн", "Prototype", "Production pipeline"],

  // --- models ---
  ["model_heuristic", "Модель", "Проста евристика", "A model", "A simple heuristic"],
  ["ml_ifelse", "ML", "Кілька if-ів", "ML", "A few if-statements"],
  ["explainable_blackbox", "Інтерпретовно", "Чорна скринька", "Explainable", "Black box"],
  ["overfit_underfit", "Перенавчання", "Недонавчання", "Overfitting", "Underfitting"],
  ["precision_recall", "Precision", "Recall", "Precision", "Recall"],
  ["false_pos_neg", "Хибнопозитивний", "Хибнонегативний", "False positive", "False negative"],
  ["train_prod_gap", "Розрив train/prod", "Усе співпадає", "Train/prod gap", "Consistent"],
  ["feature_leak_clean", "Лік фіч", "Чисті фічі", "Feature leakage", "Clean features"],
  ["label_noise_clean", "Шумні мітки", "Чисті мітки", "Noisy labels", "Clean labels"],
  ["baseline_sota", "Бейзлайн", "SOTA", "Baseline", "State of the art"],
  ["goodenough_perfect", "Достатньо добре", "Ідеальна точність", "Good enough", "Perfect accuracy"],

  // --- metrics ---
  ["real_vanity", "Справжня метрика", "Vanity-метрика", "Real metric", "Vanity metric"],
  ["northstar_random", "North star", "Випадкова метрика", "North star metric", "Random metric"],
  ["leading_lagging", "Опереджальний індикатор", "Запізнілий індикатор", "Leading indicator", "Lagging indicator"],
  ["one_metric_twenty", "Одна метрика", "Двадцять метрик", "One metric", "Twenty metrics"],
  ["absolute_relative", "Абсолютні числа", "Відсотки", "Absolute numbers", "Percentages"],
  ["cohort_snapshot", "Когортний аналіз", "Знімок на дату", "Cohort analysis", "Point-in-time snapshot"],
  ["seasonality_trend", "Сезонність", "Тренд", "Seasonality", "Trend"],
  ["spike_drift", "Різкий стрибок", "Плавний дрейф", "A spike", "A slow drift"],
  ["funnel_leak_ok", "Витік у воронці", "Здорова воронка", "Funnel leak", "Healthy funnel"],
  ["dau_mau", "DAU", "MAU", "DAU", "MAU"],
  ["retention_acquisition", "Ретеншн", "Залучення", "Retention", "Acquisition"],
  ["churn_growth", "Відтік", "Ріст", "Churn", "Growth"],
  ["ltv_cac", "LTV", "CAC", "LTV", "CAC"],
  ["revenue_engagement", "Дохід", "Залученість", "Revenue", "Engagement"],
  ["segment_average", "По сегментах", "У середньому", "By segment", "On average"],
  ["definition_agreed_disputed", "Метрика узгоджена", "Кожен рахує по-своєму", "Agreed definition", "Everyone counts differently"],

  // --- ways of knowing & telling ---
  ["datadriven_gut", "Data-driven", "На відчуттях", "Data-driven", "Gut feeling"],
  ["qual_quant", "Якісні дані", "Кількісні дані", "Qualitative", "Quantitative"],
  ["survey_logs", "Опитування", "Логи", "A survey", "The logs"],
  ["interview_dashboard", "Інтерв'ю з юзером", "Дашборд", "A user interview", "A dashboard"],
  ["selfreported_measured", "Зі слів юзерів", "Заміряно", "Self-reported", "Measured"],
  ["chartjunk_clear", "Перевантажений графік", "Ясний графік", "Chart junk", "A clear chart"],
  ["pie_bar", "Пайчарт", "Барчарт", "Pie chart", "Bar chart"],
  ["log_linear", "Логарифмічна шкала", "Лінійна шкала", "Log scale", "Linear scale"],
  ["axis_zero_cropped", "Вісь від нуля", "Обрізана вісь", "Axis from zero", "Cropped axis"],
  ["table_chart", "Таблиця", "Графік", "A table", "A chart"],
  ["onepager_deck", "Одна сторінка", "Дека на сорок слайдів", "A one-pager", "A 40-slide deck"],
  ["adhoc_recurring", "Ad-hoc запит", "Регулярний звіт", "Ad-hoc request", "Recurring report"],
  ["selfserve_ask_analyst", "Self-serve", "Питати аналітика", "Self-serve", "Ask the analyst"],
  ["documented_tribal", "Задокументовано", "Знання в головах", "Documented", "Tribal knowledge"],
  ["pii_anonymous", "Персональні дані", "Анонімно", "Personal data", "Anonymous"],
  ["gdpr_risk_safe", "Ризик для GDPR", "Безпечно з даними", "GDPR risk", "Privacy-safe"],
] as const;

function build(rows: readonly Row[], category: Category): Scale[] {
  return rows.map(([key, uaL, uaR, enL, enR]) => ({
    key,
    category,
    l: { ua: uaL, en: enL },
    r: { ua: uaR, en: enR },
  }));
}

export const SCALES: Scale[] = [...build(GENERAL, "general"), ...build(ANALYTICS, "analytics")];

const BY_KEY = new Map(SCALES.map((s) => [s.key, s]));

export function scaleByKey(key: string): Scale | undefined {
  return BY_KEY.get(key);
}

export function scalesForCategories(categories: string[]): Scale[] {
  return filterByCategories(SCALES, categories);
}
