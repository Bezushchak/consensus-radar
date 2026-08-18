import type { Lang } from "./scales";

/**
 * Tiny i18n: flat dictionary with {placeholders}. Keeping it dependency-free
 * means the strings can be shared by server routes and client components.
 */

type Dict = Record<string, { ua: string; en: string }>;

export const STRINGS: Dict = {
  tagline: { ua: "Налаштуйтесь на хвилю команди", en: "Tune into your team's wavelength" },
  footer: { ua: "гра-калібрування у стилі Wavelength", en: "a Wavelength-style calibration game" },
  leaderboardLink: { ua: "Лідерборд", en: "Leaderboard" },
  homeLink: { ua: "На головну", en: "Home" },
  pts: { ua: "очок", en: "pts" },
  round: { ua: "Раунд", en: "Round" },
  loading: { ua: "Завантаження…", en: "Loading…" },
  retry: { ua: "Спробувати ще", en: "Try again" },
  copy: { ua: "Скопіювати", en: "Copy" },
  copied: { ua: "Скопійовано!", en: "Copied!" },

  // ---- home ----
  homeTitle: { ua: "Грайте разом, кожен зі свого телефона", en: "Play together, everyone on their own phone" },
  homeSub: {
    ua: "Один гравець бачить таємну точку на шкалі й дає clue. Його команда ставить маркери — сервер зводить їх у середнє й нараховує очки.",
    en: "One player sees a hidden spot on the dial and gives a clue. Their team places markers — the server averages them and scores the round.",
  },
  createTitle: { ua: "Створити кімнату", en: "Create a room" },
  joinTitle: { ua: "Приєднатися", en: "Join a room" },
  yourName: { ua: "Ваше ім'я", en: "Your name" },
  namePlaceholder: { ua: "Як вас показувати", en: "How you'll appear" },
  teamsLabel: { ua: "Команди", en: "Teams" },
  addTeam: { ua: "+ Додати команду", en: "+ Add team" },
  catLabel: { ua: "Категорії шкал", en: "Scale categories" },
  catGeneral: { ua: "Загальні та смішні", en: "General & fun" },
  catAnalytics: { ua: "Для аналітиків", en: "Analytics team" },
  targetLabel: { ua: "Грати до (очок)", en: "Play to (points)" },
  endless: { ua: "Без ліміту", en: "Endless" },
  betsLabel: { ua: "Ставки для інших команд (+1 за вгаданий бік)", en: "Side bets for other teams (+1 for the right side)" },
  createBtn: { ua: "Створити кімнату", en: "Create room" },
  codeLabel: { ua: "Код кімнати", en: "Room code" },
  joinBtn: { ua: "Увійти в кімнату", en: "Join room" },
  rejoinBtn: { ua: "Повернутися в кімнату {code}", en: "Back to room {code}" },

  // ---- lobby ----
  lobbyTitle: { ua: "Лоббі", en: "Lobby" },
  shareHint: { ua: "Продиктуйте код або киньте посилання — і всі заходять зі своїх телефонів.", en: "Read out the code or share the link — everyone joins from their own phone." },
  pickTeam: { ua: "Ваша команда", en: "Your team" },
  playersIn: { ua: "Гравці в кімнаті", en: "Players in the room" },
  hostBadge: { ua: "хост", en: "host" },
  startBtn: { ua: "Почати гру", en: "Start game" },
  needTwoTeams: { ua: "Потрібно щонайменше по одному гравцю у двох командах.", en: "At least two teams need one player each." },
  waitingHost: { ua: "Чекаємо, поки хост почне гру…", en: "Waiting for the host to start the game…" },
  settingsTitle: { ua: "Налаштування", en: "Settings" },
  saveSettings: { ua: "Зберегти налаштування", en: "Save settings" },
  settingsSaved: { ua: "Налаштування збережено.", en: "Settings saved." },
  leaveBtn: { ua: "Вийти з кімнати", en: "Leave room" },

  // ---- clue phase ----
  clueTitle: { ua: "Ваша таємна точка", en: "Your secret spot" },
  clueSub: { ua: "Дайте clue, що наведе команду на цю точку. Не називайте число!", en: "Give a clue that points your team to this spot. Don't say a number!" },
  targetIs: { ua: "Маркер має стати сюди", en: "The marker should land here" },
  cluePlaceholder: { ua: "Напишіть clue…", en: "Type your clue…" },
  sendClue: { ua: "Надіслати clue команді", en: "Send the clue to the team" },
  noNumbers: { ua: "Без цифр у clue — у цьому вся гра!", en: "No numbers in the clue — that's the whole game!" },
  waitClue: { ua: "{name} придумує clue…", en: "{name} is thinking of a clue…" },
  youGiveClue: { ua: "Ви даєте clue цього раунду", en: "You're the clue-giver this round" },
  clueGiverIs: { ua: "Clue дає {name} ({team})", en: "{name} from {team} gives the clue" },

  // ---- guess phase ----
  clueLabel: { ua: "Clue", en: "Clue" },
  guessTitle: { ua: "Де ця точка?", en: "Where's the spot?" },
  guessSub: { ua: "Поставте свій маркер. Фінальна позиція команди — середнє всіх маркерів.", en: "Place your own marker. The team's final position is the average of all markers." },
  submitGuess: { ua: "Зафіксувати маркер", en: "Lock in my marker" },
  changeGuess: { ua: "Змінити маркер", en: "Change my marker" },
  guessLocked: { ua: "Маркер зафіксовано: {value}%", en: "Marker locked at {value}%" },
  marker: { ua: "Маркер", en: "Marker" },
  submittedCount: { ua: "Зафіксували: {done} з {total}", en: "Locked in: {done} of {total}" },
  watchingTitle: { ua: "Команда «{team}» відгадує", en: "Team \"{team}\" is guessing" },
  betTitle: { ua: "Ваша ставка", en: "Your side bet" },
  betSub: { ua: "З якого боку від таємної точки стане маркер?", en: "Which side of the secret spot will their marker land on?" },
  betLeft: { ua: "◀ Лівіше", en: "◀ To the left" },
  betRight: { ua: "Правіше ▶", en: "To the right ▶" },
  betPlaced: { ua: "Ставка зроблена: {side}", en: "Bet placed: {side}" },
  sideLeft: { ua: "лівіше", en: "left" },
  sideRight: { ua: "правіше", en: "right" },
  revealNow: { ua: "Відкрити зараз", en: "Reveal now" },
  noGuessers: {
    ua: "У цій команді нікому відгадувати — потрібен ще хоча б один гравець. Можна відкрити раунд і йти далі.",
    en: "Nobody on this team can guess — it needs at least one more player. You can reveal and move on.",
  },
  soloTeamWarn: {
    ua: "Команди з одним гравцем не зможуть відгадувати: той, хто дає clue, не ставить маркер.",
    en: "Teams with a single player can't guess: the clue-giver doesn't place a marker.",
  },
  waitingOthers: { ua: "Чекаємо на інших…", en: "Waiting for the others…" },

  // ---- reveal ----
  revealTitle: { ua: "Розкриття", en: "The reveal" },
  secretWas: { ua: "таємна точка", en: "secret spot" },
  markerWas: { ua: "маркер команди", en: "team marker" },
  msgBull: { ua: "В яблучко! Ідеальна калібровка 🎯", en: "Bullseye! Perfect calibration 🎯" },
  msgClose: { ua: "Близько! Гарне відчуття одне одного.", en: "Close! Nicely tuned in." },
  msgFar: { ua: "Мимо — нуль за цей раунд.", en: "Missed it — zero this round." },
  msgOpp: { ua: "Зовсім протилежний бік. −2.", en: "Totally opposite side. −2." },
  individualGuesses: { ua: "Хто куди ставив", en: "Who placed what" },
  betResults: { ua: "Ставки", en: "Side bets" },
  betRight2: { ua: "вгадав бік", en: "called it" },
  betWrong: { ua: "мимо", en: "missed" },
  nextBtn: { ua: "Наступний раунд", en: "Next round" },
  waitNext: { ua: "Хост запускає наступний раунд…", en: "The host is starting the next round…" },

  // ---- scoreboard / winner ----
  scoresTitle: { ua: "Рахунок", en: "Scores" },
  winnerTitle: { ua: "Перемогла команда «{team}»!", en: "Team \"{team}\" wins!" },
  winnerSub: { ua: "Ваші хвилі збіглися найкраще.", en: "Your wavelengths matched best." },
  playAgain: { ua: "Зіграти ще", en: "Play again" },
  endGame: { ua: "Завершити гру", en: "End the game" },
  resultsSaved: { ua: "Результат збережено в лідерборд.", en: "The result has been saved to the leaderboard." },

  // ---- leaderboard ----
  lbTitle: { ua: "Лідерборд", en: "Leaderboard" },
  lbSub: { ua: "Усе, що зберігає бекенд після завершених ігор.", en: "Everything the backend keeps after finished games." },
  lbTeams: { ua: "Команди", en: "Teams" },
  lbRounds: { ua: "Найкращі раунди", en: "Best rounds" },
  lbPlayers: { ua: "Гравці", en: "Players" },
  lbScales: { ua: "Найважчі шкали", en: "Hardest scales" },
  periodAll: { ua: "За весь час", en: "All time" },
  periodMonth: { ua: "30 днів", en: "30 days" },
  periodWeek: { ua: "7 днів", en: "7 days" },
  lbEmpty: { ua: "Тут поки нічого. Догравайте гру до кінця — і результат з'явиться.", en: "Nothing here yet. Finish a game and the result will show up." },
  colTeam: { ua: "Команда", en: "Team" },
  colScore: { ua: "Очки", en: "Score" },
  colRounds: { ua: "Раундів", en: "Rounds" },
  colAvgDist: { ua: "Сер. похибка", en: "Avg miss" },
  colPlayers: { ua: "Склад", en: "Roster" },
  colWhen: { ua: "Коли", en: "When" },
  colScale: { ua: "Шкала", en: "Scale" },
  colClue: { ua: "Clue", en: "Clue" },
  colMiss: { ua: "Похибка", en: "Miss" },
  colPlayer: { ua: "Гравець", en: "Player" },
  colClues: { ua: "Clue дано", en: "Clues given" },
  colCluePts: { ua: "Сер. очок за clue", en: "Avg pts per clue" },
  colGuesses: { ua: "Здогадок", en: "Guesses" },
  colGuessDist: { ua: "Сер. похибка здогадок", en: "Avg guess miss" },
  colBets: { ua: "Ставок вгадано", en: "Bets won" },
  colTimes: { ua: "Разів у грі", en: "Times played" },
  colBullseyes: { ua: "Яблучок", en: "Bullseyes" },
  lbHint: { ua: "Без реєстрації гравець — це його пристрій: усі ігри з цього браузера зводяться в один рядок. Інший браузер або телефон буде окремим гравцем.", en: "With no sign-in, a player is their device: every game from this browser counts as one row. Another browser or phone shows up as a separate player." },
};

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let out = entry ? entry[lang] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

export type { Lang };
