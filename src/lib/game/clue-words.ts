/**
 * The word data behind the clue rules. Kept apart from the logic in `clue.ts`
 * so the lists can be edited without reading the algorithm — and so the
 * algorithm can be read without wading through several hundred words.
 *
 * Everything here is lowercase, with apostrophes normalised to ASCII `'`.
 * `normalizeWord` in `clue.ts` puts every token into that same shape before
 * looking it up, so a clue typed with a curly apostrophe still matches.
 */

/**
 * Number words spelled out, matched whole. English does not inflect, so the
 * exact set carries it; Ukrainian does, which is what `NUMBER_STEMS` is for.
 *
 * Multipliers (double, triple, подвійний) are deliberately absent. They are
 * not numbers, they are common adjectives, and rejecting "double trouble"
 * would be a worse outcome than letting it through.
 */
export const NUMBER_WORDS: ReadonlySet<string> = new Set([
  // English cardinals
  "zero", "nought", "nil", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
  "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds",
  "thousand", "thousands", "million", "millions", "billion", "billions",
  "trillion", "trillions",
  // English ordinals
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
  "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth",
  "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
  "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth",
  "eightieth", "ninetieth", "hundredth", "thousandth",
  "firstly", "secondly", "thirdly",
  // English fractions, counts and rates
  "half", "halves", "halfway", "midway", "quarter", "quarters", "thirds",
  "fourths", "fifths", "sixths", "sevenths", "eighths", "ninths", "tenths",
  "dozen", "dozens", "percent", "percentage", "percentile", "once", "twice",
  "thrice",

  // Ukrainian forms that no stem below reaches, or where a stem would be unsafe
  "нуль", "нуля", "нулю", "нулем", "нулів",
  "один", "одна", "одне", "одно", "одного", "одному", "одним", "одній", "одною",
  "одні", "одних", "одиниця", "одиницю",
  "два", "дві", "двох", "двом", "двома", "двоє", "двійка", "двійку",
  "три", "трьох", "трьом", "трьома", "троє", "трійка", "трійку",
  "чотири", "чотирьох", "чотирьом", "чотирма", "четверо",
  "семи", "семеро", "сімох", "сімка", "сімку",
  "сорок",
  "сто", "двісті", "триста", "чотириста",
  "раз", "рази", "разів", "разу", "двічі", "тричі",
  // "second": only the inflections that cannot be read as "friend"
  "другий", "другому", "другим", "друге", "другій", "другою", "другі", "других",
]);

/**
 * Ukrainian number families, matched as a prefix. Inflection makes an exact
 * list hopeless — "п'ять" alone appears as п'яти, п'ятьох, п'ятьма, п'ятий,
 * п'ятого — so the shared stem does the work instead.
 *
 * Two families are missing on purpose, because in Ukrainian they collide with
 * ordinary words and a false rejection is worse than a miss:
 *
 *   - "другий" (second) shares its stem with "друг" (friend), so only the
 *     unambiguous inflections are listed as exact words below.
 *   - "сорок" (forty) is a prefix of "сорока" (magpie), so it stays exact.
 */
export const NUMBER_STEMS: readonly string[] = [
  // cardinals
  "п'ят", "шіст", "шест", "сім", "вісім", "восьм", "вісьм", "дев'ят",
  "дев'яност", "десят", "одинадцят", "дванадцят", "тринадцят", "чотирнадцят",
  "п'ятнадцят", "шістнадцят", "сімнадцят", "вісімнадцят", "дев'ятнадцят",
  "двадцят", "тридцят", "тисяч", "мільйон", "мільярд", "трильйон",
  // ordinals
  "перш", "трет", "четверт", "шост", "сьом",
  // fractions and rates
  "половин", "чверт", "відсот", "процент", "дюжин",
];

/**
 * Real words a stem above would otherwise swallow. Checked first, so they win.
 * "п'ятниця" is Friday, not five; "сьомга" is salmon, not seventh.
 */
export const NUMBER_EXEMPT: ReadonlySet<string> = new Set([
  "п'ятниця", "п'ятниці", "п'ятницю", "п'ятницею", "п'ятницях",
  "сьомга", "сьомги", "сьомгу",
  "сім'я", "сім'ї", "сім'ю", "сім'єю", "сімейний", "сімейна", "сімейне",
  "десятина", "десятини",
  "друг", "друга", "другом", "другого", "друзі", "друзів",
]);

/**
 * Words that do not count toward the word cap: articles, prepositions and the
 * plain coordinating conjunctions. They carry grammar rather than meaning, and
 * making a player spend one of six words on "the" would just teach them to
 * write telegrams.
 *
 * Ukrainian has no articles, so its side is prepositions and conjunctions only.
 */
export const FREE_WORDS: ReadonlySet<string> = new Set([
  // English articles and conjunctions
  "a", "an", "the", "and", "or", "nor", "but", "yet", "than", "as",
  // English prepositions
  "of", "in", "on", "at", "to", "for", "with", "without", "by", "from", "into",
  "onto", "upon", "over", "under", "above", "below", "beneath", "between",
  "among", "around", "across", "through", "throughout", "during", "after",
  "before", "about", "against", "along", "behind", "beyond", "beside",
  "besides", "near", "off", "out", "up", "down", "per", "via", "toward",
  "towards", "within", "inside", "outside", "despite", "unlike", "like",

  // Ukrainian prepositions
  "в", "у", "на", "з", "із", "зі", "зо", "до", "від", "од", "за", "під", "над",
  "про", "для", "по", "при", "без", "між", "через", "після", "перед", "біля",
  "коло", "крізь", "серед", "поза", "поміж", "попід", "щодо", "замість",
  "окрім", "крім", "проти", "задля", "заради", "згідно", "навколо",
  "всередині", "поруч", "напроти",
  // Ukrainian conjunctions
  "і", "й", "та", "або", "чи", "а", "але", "проте", "однак", "ж", "же",
]);

/**
 * The vocabulary used to detect words glued together. Deliberately short and
 * ordinary: these are the words people reach for when they cram a sentence
 * into one token, and the ones long real words are least likely to be built
 * out of. `clue.ts` only tries to segment tokens that are already suspiciously
 * long, and only rejects when the whole token decomposes into three or more of
 * these — so "solikethisword" (so + like + this + word) is caught while
 * "responsibility" and "відповідальність", which do not decompose at all,
 * are not.
 *
 * Single letters are excluded by a minimum part length in `clue.ts`; with them
 * in play almost any word decomposes.
 */
export const GLUE_PARTS: ReadonlySet<string> = new Set([
  ...FREE_WORDS,
  // English function and filler words
  "all", "also", "am", "any", "anything", "are", "back", "bad", "be", "been",
  "being", "best", "better", "big", "bit", "both", "can", "cannot", "come",
  "cool", "could", "day", "did", "do", "does", "doing", "done", "dont", "each",
  "else", "end", "even", "ever", "every", "far", "fast", "feel", "few", "find",
  "fun",
  "get", "give", "go", "going", "good", "got", "great", "had", "has", "have",
  "he", "her", "here", "hers", "high", "him", "his", "hot", "how", "if", "is",
  "it", "its", "just", "keep", "kind", "know", "last", "late", "least", "less",
  "let", "life", "little", "long", "look", "lot", "love", "low", "made", "make",
  "man", "many", "may", "me", "more", "most", "much", "must", "my", "need",
  "never", "new", "next", "nice", "no", "not", "now", "old", "only", "other",
  "our", "own", "part", "put", "real", "right", "said", "same", "say", "see",
  "she", "should", "show", "side", "slow", "small", "so", "some", "soon",
  "still", "stop", "such", "sure", "take", "tell", "that", "their", "them",
  "then", "there", "these", "they", "thing", "things", "think", "this",
  "those", "time", "too", "top", "try", "us", "use", "very", "want", "was",
  "way", "we", "well", "went", "were", "what", "when", "where", "which",
  "while", "who", "why", "will", "word", "words", "work", "world", "would",
  "yes", "you", "your",
  // A few number words, so a glued token gets caught by the number rule too
  "one", "two", "six", "ten", "nine", "five", "four", "half", "hundred",
  "percent",

  // Ukrainian function and filler words
  "аж", "би", "бо", "буде", "був", "була", "було", "бути", "вам", "вас",
  "вже", "ви", "вона", "вони", "воно", "все", "всі", "він", "де", "дуже",
  "є", "коли", "куди", "майже", "мало", "ми", "мій", "мене", "мені", "може",
  "можна", "нам", "нас", "наш", "не", "немає", "ні", "ніби", "них", "ну",
  "сам", "само", "свій", "скоро", "так", "також", "там", "твій", "те", "теж",
  "тепер", "ти", "то", "тобі", "того", "тоді", "той", "тому", "треба", "тут",
  "хоч", "хто", "це", "цей", "що", "щоб", "як", "яка", "який", "якщо", "ще",
  "вниз", "вгору", "добре", "погано", "швидко", "повільно", "високо",
  "низько", "багато", "трохи", "зовсім", "схоже", "точно", "зверху", "знизу",
  "далеко", "близько", "нове", "старе", "гарно", "час", "день", "слово",
  "слова", "люди", "світ", "життя",
  // Ukrainian number words, same reason as the English ones above
  "три", "сто", "десять", "п'ять", "два", "дві",
]);

/**
 * Long real words that do decompose into the parts above, and so would be
 * rejected as glued if they were not named here. Checked before segmentation.
 *
 * Only words at or above the length threshold in `clue.ts` matter — shorter
 * ones are never segmented in the first place — so this list is short by
 * design and grows only when a real word turns out to be caught.
 */
export const GLUE_EXEMPT: ReadonlySet<string> = new Set([
  "nevertheless", "notwithstanding", "nonetheless", "understanding",
  "understandable", "understandably", "straightforward", "whatsoever",
  "aforementioned", "henceforward", "thenceforth", "whereabouts",
  "wholeheartedly", "lighthearted", "somethingness",
  "щонайменше", "щонайбільше", "неодноразово", "водночас", "натомість",
  "насамперед", "безперечно", "незважаючи", "щонайшвидше",
]);
