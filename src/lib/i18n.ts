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
  needTwoTeams: {
    ua: "Потрібно щонайменше дві команди по два гравці. Той, хто дає підказку, не ставить маркер, тому команді з однією людиною нікому відгадувати.",
    en: "You need at least two teams with two players each. The clue-giver does not place a marker, so a team of one has nobody to guess.",
  },
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
  // One message per rejection reason, so the player is told what to change
  // rather than that something is wrong. The keys are chosen by
  // `clueErrorKey` in src/lib/game/clue.ts — keep the two in step.
  clueEmpty: { ua: "Clue не може бути порожнім.", en: "The clue cannot be empty." },
  clueNumberWord: {
    ua: "Числа словами теж не можна — «{word}» це число.",
    en: "Numbers spelled out count too — “{word}” is a number.",
  },
  clueTooMany: {
    ua: "Максимум {max} слів, а тут {count}. Артиклі та прийменники не рахуються.",
    en: "Up to {max} words, and this has {count}. Articles and prepositions are free.",
  },
  clueGlued: {
    ua: "«{word}» схоже на кілька слів, склеєних разом — розділіть їх пробілами.",
    en: "“{word}” looks like several words glued together — put spaces between them.",
  },
  clueLongWord: {
    ua: "«{word}» задовге для одного слова (максимум {max} символів).",
    en: "“{word}” is too long to be one word (max {max} characters).",
  },
  clueRules: {
    ua: "До {max} слів, без чисел. Артиклі та прийменники не рахуються.",
    en: "Up to {max} words, no numbers. Articles and prepositions are free.",
  },
  clueWordCount: { ua: "{count} з {max}", en: "{count} of {max}" },
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
  // Shown only to a team that is watching, not guessing. Their markers are
  // visible to you precisely because you have to bet on them.
  watchMarkers: {
    ua: "Ви бачите їхні маркери — вони з'являються на радарі. Свої вони одне одного не бачать.",
    en: "You can see their markers appear on the dial. They cannot see each other's.",
  },
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
    ua: "У цих командах лише один гравець — доберіть їм пару або переведіть цих людей в іншу команду, інакше гру не почати:",
    en: "These teams have only one player — give them a partner or move those people to another team, otherwise the game cannot start:",
  },
  waitingOthers: { ua: "Чекаємо на інших…", en: "Waiting for the others…" },

  // ---- rescuing a stuck round ----
  // The clue-giver is the one person a round cannot continue without. If they
  // close the tab, the guessers are left on a screen with no button on it, so
  // the escape hatch has to be visible to them and not only to the host.
  skipRound: { ua: "Пропустити раунд", en: "Skip this round" },
  skipHint: {
    ua: "Якщо clue так і не з'явиться — пропустіть раунд. Рахунок не змінюється, шкала повертається в колоду, хід переходить наступній команді.",
    en: "If the clue never arrives, skip the round. Nothing is scored, the scale goes back in the deck, and the turn passes to the next team.",
  },
  skipConfirm: {
    ua: "Пропустити цей раунд без нарахування очок?",
    en: "Skip this round without scoring it?",
  },

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

  // ---- per-player calibration, end of game ----
  calibTitle: { ua: "Хто як влучав", en: "How close each of you got" },
  calibSub: {
    ua: "Середня похибка ваших власних маркерів. Очки — командні, це — особисте.",
    en: "The average error of your own markers. The points are the team's; this is yours.",
  },
  calibAvg: { ua: "середня похибка", en: "average error" },
  calibBest: { ua: "найкращий", en: "best" },
  calibBulls: { ua: "в яблучко", en: "bullseyes" },
  calibBets: { ua: "ставки", en: "bets" },
  calibNoMarkers: { ua: "лише clue", en: "clues only" },
  calibEmpty: {
    ua: "Ще нема жодного розкритого раунду.",
    en: "No round has been revealed yet.",
  },

  // ---- the host has gone quiet ----
  // Start, settings and end-game are host-only, so a host who closes the tab
  // freezes the room for everybody else. Anyone left can pick the crown up.
  hostAwayTitle: { ua: "Хост не відповідає", en: "The host has gone quiet" },
  hostAwaySub: {
    ua: "Від хоста не було чути кілька хвилин. Кнопки старту й налаштувань — тільки в нього, тож хтось має перебрати роль.",
    en: "Nothing has been heard from the host for a few minutes. Starting, settings and ending the game are host-only, so someone needs to take over.",
  },
  claimHostBtn: { ua: "Стати хостом", en: "Take over as host" },

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
  lbYou: { ua: "це ви", en: "you" },
  lbHint: { ua: "Без реєстрації гравець — це його пристрій: усі ігри з цього браузера зводяться в один рядок. Інший браузер або телефон буде окремим гравцем.", en: "With no sign-in, a player is their device: every game from this browser counts as one row. Another browser or phone shows up as a separate player." },
  lbTagHint: {
    ua: "Два різних гравці з однаковим ім'ям — це два різних рядки; щоб їх було видно, до імені додається короткий код пристрою (напр. «Dmytro · K7QM»). Ваш рядок підсвічено.",
    en: "Two different people with the same name are two different rows; to tell them apart each gets a short device code next to the name (e.g. \"Dmytro · K7QM\"). Your own row is highlighted.",
  },

  // ---------------- how to play ----------------
  howToLink: { ua: "Як грати", en: "How to play" },
  howToTitle: { ua: "Як грати", en: "How to play" },
  howToSub: {
    ua: "Хвилинна демонстрація: гравці-статисти проходять весь шлях — від коду кімнати до розкриття. Нижче ті самі правила словами.",
    en: "A one-minute demo: stand-in players walk the whole path, from room code to the reveal. The same rules in words are underneath.",
  },
  howToRulesTitle: { ua: "Правила коротко", en: "The rules in short" },
  howToSetupRules: {
    ua: "Кімната живе за кодом із чотирьох символів: хост створює її, решта заходять зі своїх телефонів — застосунок нічого не встановлює й нікого не реєструє. У команді потрібні щонайменше двоє, бо той, хто дає clue, маркер не ставить. Грати можна до 15–30 очок або без ліміту; результат завершеної гри осідає в лідерборді.",
    en: "A room lives behind a four-character code: the host creates it and everyone else joins from their own phone — nothing to install, nobody to sign up. A team needs at least two people, because the clue-giver doesn't place a marker. Games run to 15–30 points or endlessly, and a finished game's result lands on the leaderboard.",
  },
  howToGoal: {
    ua: "Раунд починається зі шкали між двома полюсами і таємної точки на ній, яку бачить лише той, хто дає clue. Він описує її словами; його команда ставить маркери, не бачачи маркерів одне одного, а фінальна позиція команди — середнє з них. Чим ближче до точки, тим більше очок: похибка до 5 — п'ять очок, до 12 — три, далі нуль, а протилежний бік шкали коштує −2.",
    en: "A round opens with a scale between two poles and a secret spot on it that only the clue-giver sees. They describe it in words; their team places markers without seeing each other's, and the team's final position is the average of them. The closer to the spot, the more points: within 5 scores five, within 12 scores three, further out scores nothing, and the opposite end of the scale costs −2.",
  },
  howToClueRules: {
    ua: "У clue не можна числа — ні цифрами («50%»), ні словами («половина», «сорок»), ні склеєними всередині слова. Слів, що несуть зміст, максимум шість; артиклі, прийменники та сполучники безкоштовні. Ті самі правила працюють і в браузері, і на сервері, тож форма ніколи не пропустить того, що сервер відхилить.",
    en: "A clue may not contain numbers — not as digits (\"50%\"), not spelled out (\"half\", \"forty\"), not glued inside a word. At most six words carry meaning; articles, prepositions and conjunctions are free. The same rules run in the browser and on the server, so the form never accepts something the server would refuse.",
  },
  howToBetsRules: {
    ua: "Поки одна команда відгадує, інші бачать clue і маркери, що з'являються на радарі, та ставлять на бік: маркер стане лівіше чи правіше від таємної точки? Якщо більшість команди вгадала — плюс очко. А от гравці команди, що відгадує, маркерів одне одного до розкриття не бачать: інакше раунд міряв би згоду, а не калібрування.",
    en: "While one team guesses, the others see the clue and watch the markers appear on the dial, then call the side: will the marker land left or right of the secret spot? If most of the team calls it right, they get a point. The guessing team, though, cannot see each other's markers before the reveal — otherwise the round would measure agreement rather than calibration.",
  },

  // The demo player's own furniture.
  demoPlay: { ua: "Продовжити", en: "Play" },
  demoPause: { ua: "Пауза", en: "Pause" },
  demoRestart: { ua: "З початку", en: "Restart" },
  demoNotReal: {
    ua: "Це записана демонстрація — кнопки всередині рамки не працюють, вона грає сама.",
    en: "This is a scripted demo — the controls inside the frame don't work, it plays itself.",
  },
  demoHostNote: {
    ua: "Хост натомість тисне «Створити кімнату» — тут ми заходимо в готову.",
    en: "The host presses \"Create room\" instead — here we're joining one that exists.",
  },
  demoRoleNew: { ua: "приєднується", en: "joining" },
  demoRoleClue: { ua: "дає clue", en: "clue-giver" },
  demoRoleGuess: { ua: "відгадує", en: "guessing" },
  demoRoleWatch: { ua: "ставить", en: "betting" },

  // Narration. One sentence per beat: it has to be readable in the time the
  // cursor takes to get to the next thing.
  demoJoin1: {
    ua: "Хост диктує код із чотирьох символів. Кожен вводить його на своєму телефоні.",
    en: "The host reads out a four-character code. Everyone types it on their own phone.",
  },
  demoJoin2: {
    ua: "Спершу ім'я, яким вас бачитимуть інші.",
    en: "First, the name everyone else will see.",
  },
  demoJoin3: {
    ua: "Застосунок садить у меншу команду — пересісти можна тут же. Двоє в команді — мінімум: той, хто дає clue, маркер не ставить.",
    en: "The app seats you in the smaller team — you can move right here. Two per team is the minimum: the clue-giver doesn't place a marker.",
  },
  demoLobby1: {
    ua: "У лоббі видно всіх, хто зайшов, і хто в якій команді.",
    en: "The lobby shows everyone who's in, and which team they're on.",
  },
  demoLobby2: {
    ua: "Гру починає хост — тож далі дивимось на його телефон.",
    en: "The host starts the game — so we switch to their phone.",
  },
  demoClue1: {
    ua: "Раунд починається зі шкали і таємної точки. Її бачить лише той, хто дає clue.",
    en: "A round opens with a scale and a secret spot. Only the clue-giver sees it.",
  },
  demoClue2: {
    ua: "Тепер clue — до шести слів, які наведуть команду на цю точку.",
    en: "Now the clue — up to six words that point the team at that spot.",
  },
  demoClue3: {
    ua: "Числа заборонені: і цифрами, і словами. Кнопка просто не працює.",
    en: "Numbers are out, as digits and as words. The button simply stays dead.",
  },
  demoClue4: { ua: "Ось так краще. Жодного числа.", en: "Better. Not a number in sight." },
  demoGuess1: {
    ua: "Тепер телефон Dana. Вона бачить clue, але не таємну точку.",
    en: "Now Dana's phone. She sees the clue, but not the secret spot.",
  },
  demoGuess2: {
    ua: "Кожен ставить свій маркер окремо. Відповідь команди — середнє з них.",
    en: "Everyone places their own marker. The team's answer is the average of them.",
  },
  demoWatch1: {
    ua: "А це телефон іншої команди: вони бачать і clue, і маркери, що з'являються.",
    en: "And this is the other team's phone: they see the clue and the markers appearing.",
  },
  demoWatch2: {
    ua: "Їхня ставка — маркер стане лівіше чи правіше від таємної точки?",
    en: "Their call: will the marker land left or right of the secret spot?",
  },
  demoReveal1: {
    ua: "Розкриття. Середнє команди — {marker}, точка була на {target}: похибка мала, {points} очки.",
    en: "The reveal. The team averaged {marker}, the spot was at {target}: a small miss, {points} points.",
  },
  demoReveal2: {
    ua: "Хто куди ставив — видно всім. Ставки теж: більшість «Шуму» вгадала бік, тож і їм очко.",
    en: "Who placed what is public. So are the bets: most of Noise called the side, so they score too.",
  },
  demoNext: {
    ua: "Далі новий раунд: інша шкала, clue дає інша людина. І так до цілі.",
    en: "Then a new round: another scale, someone else gives the clue. Repeat until the target.",
  },
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
