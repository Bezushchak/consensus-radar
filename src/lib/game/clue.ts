/**
 * What a clue is allowed to say. Pure, so the same function decides on the
 * server and in the input box — the client cannot be more permissive than the
 * server, and cannot be stricter either, which is the failure mode that
 * teaches players to distrust the form.
 *
 * Three rules, in order of how deterministic they are:
 *
 *   1. No numbers. Digits are the obvious half; the harder half is numbers
 *      spelled out ("forty", "п'ятдесят"), numbers hidden inside a word
 *      ("level5", "тридцятьвідсотків"), numerals welded together ("fiftyfive",
 *      "сорокп'ять") and numbers made vague on purpose ("fiftyish", "in his
 *      fifties").
 *   2. At most `MAX_CLUE_WORDS` words that carry meaning. Articles,
 *      prepositions and plain conjunctions are free — see `FREE_WORDS`.
 *   3. No words glued together to beat rule 2.
 *
 * Rule 3 is the only one that needs a heuristic, and it is deliberately
 * layered so the heuristic does as little as possible:
 *
 *   - Punctuation is a separator, not a character. `so-like-this-word`,
 *     `so.like.this.word` and `so_like_this_word` are four words, decided by
 *     the tokeniser with no guessing at all. That covers the easy evasions.
 *   - What is left is true concatenation, `solikethisword`. A length cap alone
 *     cannot separate that from a real word: it is 14 characters, while
 *     `відповідальність` is 16 and `непередбачуваність` is 18. Nor can
 *     syllable counting, because glued words are made of real words.
 *   - So: any token long enough to be suspicious is checked against a compact
 *     list of common short words, and rejected only if the *whole* token
 *     decomposes into three or more of them. `solikethisword` becomes
 *     so + like + this + word and is rejected; `responsibility` and
 *     `відповідальність` do not decompose at all and are allowed.
 *
 * The failure direction is on purpose: a token nobody can segment is allowed.
 * A player who defeats the heuristic is cheating in front of their own team,
 * and the host can already force a reveal and move on.
 *
 * Known gaps, left open knowingly.
 *
 * ASCII Roman numerals are not enforced, because `MIX`, `CD`, `XL` and `VI` are
 * valid Roman numerals and also real words, and `I` is a pronoun — the false
 * rejections would cost more than the evasion. The Unicode Roman numerals
 * (Ⅰ Ⅴ Ⅹ) *are* caught, because they sit in a number category.
 *
 * A number glued to an *ordinary* word still passes below twelve characters:
 * `fiftykaraoke` is caught as a glued word, `fiftycat` is not caught at all.
 * Separating that from a real word needs a general dictionary of both
 * languages, and the alternative — rejecting any token that merely *starts*
 * with a number word — would reject `tenacious`, `tenor`, `стонога` and
 * `сорока`. A gap in the direction of letting a clue through is the one this
 * file chooses every time.
 */

import { cleanClue } from "./engine";
import {
  FREE_WORDS,
  GLUE_EXEMPT,
  GLUE_PARTS,
  NUMBER_EXEMPT,
  NUMBER_STEMS,
  NUMBER_WORDS,
  VAGUE_SUFFIXES,
} from "./clue-words";

/** Words that carry meaning. Articles and prepositions are on top of this. */
export const MAX_CLUE_WORDS = 6;

/**
 * A ceiling on tokens including the free ones, so "the the the the the the the
 * the" cannot be a clue. Generous: twice the meaning budget.
 */
export const MAX_CLUE_TOKENS = MAX_CLUE_WORDS * 2;

/**
 * Longer than any word either language actually has —
 * `найвідповідальніший` is 19, `characteristically` is 18 — so this only ever
 * fires on something that is not a word.
 */
export const MAX_WORD_LEN = 28;

/** Tokens shorter than this are never tested for gluing. */
const GLUE_MIN_LEN = 12;
/** Fewer parts than this is how real words decompose by accident. */
const GLUE_MIN_PARTS = 3;
/** One-letter parts would segment almost anything. */
const GLUE_MIN_PART_LEN = 2;
const GLUE_MAX_PART_LEN = Math.max(...Array.from(GLUE_PARTS, (w) => w.length));

/**
 * Bounds for decomposing a token into number words. Derived from the set rather
 * than written down, so adding a shorter or longer number word cannot silently
 * put it out of reach of the search below.
 */
const NUMBER_MIN_LEN = Math.min(...Array.from(NUMBER_WORDS, (w) => w.length));
const NUMBER_MAX_LEN = Math.max(...Array.from(NUMBER_WORDS, (w) => w.length));

/**
 * `\p{N}` rather than `\p{Nd}`: it covers ASCII digits, other scripts' digits,
 * superscripts, fractions like ½ (No) and the Roman numeral characters (Nl).
 */
const HAS_NUMBER = /\p{N}/u;

/**
 * Zero-width and soft-hyphen characters. They are invisible to the guessers,
 * so they are removed rather than treated as separators — otherwise the text
 * on screen reads as one word while the count says several.
 */
// Written as escapes on purpose: a character class of literal zero-width
// characters is invisible in an editor and one stray reformat would silently
// empty it.
const INVISIBLE = new RegExp("[\\u00AD\\u200B-\\u200F\\u2060\\uFEFF]", "g");

/** Every apostrophe variant folded to ASCII, so a curly one still matches. */
const APOSTROPHE = new RegExp("[\\u02BC\\u2018\\u2019\\u0060\\u00B4\\u2032]", "g");

/**
 * A separator is anything that is not a letter, a number, a combining mark or
 * an apostrophe. That single definition is what makes hyphens, dots, slashes,
 * underscores and emoji all split words without a rule each.
 */
const SEPARATOR = /[^\p{L}\p{N}\p{M}']+/u;

export type ClueReason =
  | "empty"
  | "digits"
  | "numberWord"
  | "longWord"
  | "gluedWord"
  | "tooManyWords";

export interface ClueOk {
  ok: true;
  /** The cleaned text, exactly as it should be stored. */
  clue: string;
  words: number;
}

export interface ClueBad {
  ok: false;
  reason: ClueReason;
  /** The token at fault, when one token is at fault. */
  word: string | null;
  words: number;
}

export type ClueCheck = ClueOk | ClueBad;

/** Lowercased, invisible characters removed, apostrophes folded. */
export function normalizeWord(text: string): string {
  return text.replace(INVISIBLE, "").replace(APOSTROPHE, "'").toLowerCase();
}

/** The clue as a list of comparable tokens. */
export function clueTokens(text: string): string[] {
  return normalizeWord(text).split(SEPARATOR).filter(Boolean);
}

/** Words that count against `MAX_CLUE_WORDS`. */
export function countClueWords(text: string): number {
  return clueTokens(text).filter((w) => !FREE_WORDS.has(w)).length;
}

/**
 * True when the token is nothing but number words run together: `fiftyfive`,
 * `thirtytwo`, `onehundred`, `fiftypercent`, `twentyfirst`.
 *
 * This is the first evasion anyone tries, and until this function existed it
 * worked. The glue check in `segment` below only examines tokens of twelve
 * characters or more and only knows the handful of number words that happen to
 * be in `GLUE_PARTS`, so nine-character `fiftyfive` was never even looked at.
 * English took the whole of it, because `NUMBER_STEMS` is Ukrainian and English
 * therefore had exact matches and nothing else. Ukrainian had half of it: a stem
 * catches `п'ятдесятп'ять`, which starts with п'ят, but not `сорокп'ять`, where
 * the stem-shaped half is the tail — which is why the nominatives are spelled
 * out in `NUMBER_WORDS` for the tiling below to use as parts.
 *
 * Requiring the *entire* token to decompose is what makes this safe, and it is
 * why there is no prefix rule here. `tenacious` is ten + acious, `разом` is
 * раз + ом, `стонога` (centipede) is сто + нога, `halfhearted` is half +
 * hearted, `tenor` is ten + or — none of them decompose all the way into number
 * words, so none of them is touched. A prefix rule would reject all five.
 *
 * Longest part first with memoised backtracking, same shape as `segment`, so a
 * decomposition is found whenever one exists rather than whenever a greedy pass
 * happens to work out — `sixtyone` needs `sixty` before it can try `one`.
 */
function isGluedNumber(word: string): boolean {
  if (word.length < NUMBER_MIN_LEN * 2) return false;

  /** Can the rest of the token, from `at` on, be tiled entirely by number words? */
  const memo = new Map<number, boolean>();
  const tiles = (at: number): boolean => {
    if (at === word.length) return true;
    const seen = memo.get(at);
    if (seen !== undefined) return seen;

    let found = false;
    const longest = Math.min(word.length - at, NUMBER_MAX_LEN);
    for (let n = longest; n >= NUMBER_MIN_LEN; n--) {
      if (!NUMBER_WORDS.has(word.slice(at, at + n))) continue;
      if (tiles(at + n)) {
        found = true;
        break;
      }
    }
    memo.set(at, found);
    return found;
  };

  // The first part is required to be a *proper* prefix, which is what makes this
  // "two or more number words" rather than "is a number word". The one-part
  // answer is `NUMBER_WORDS.has`, and the only caller has already asked it.
  // Written this way rather than by counting parts inside the walk so that the
  // memo stays a function of the position alone.
  const longest = Math.min(word.length - 1, NUMBER_MAX_LEN);
  for (let n = longest; n >= NUMBER_MIN_LEN; n--) {
    if (NUMBER_WORDS.has(word.slice(0, n)) && tiles(n)) return true;
  }
  return false;
}

function isNumberWord(word: string): boolean {
  if (NUMBER_EXEMPT.has(word)) return false;
  if (NUMBER_WORDS.has(word)) return true;
  if (NUMBER_STEMS.some((stem) => word.startsWith(stem))) return true;

  // "fiftyish" is fifty. Strip the vague tail and ask again, but only once and
  // only if something usable is left, so this cannot chew a word down to a
  // coincidence.
  for (const suffix of VAGUE_SUFFIXES) {
    if (!word.endsWith(suffix)) continue;
    const rest = word.slice(0, -suffix.length);
    if (rest.length >= NUMBER_MIN_LEN && !NUMBER_EXEMPT.has(rest)) {
      if (NUMBER_WORDS.has(rest) || NUMBER_STEMS.some((stem) => rest.startsWith(stem))) {
        return true;
      }
    }
  }

  return isGluedNumber(word);
}

/**
 * Splits a token entirely into `GLUE_PARTS`, or returns null. Longest part
 * first with backtracking, so it finds a decomposition whenever one exists
 * rather than whenever a greedy pass happens to work out.
 */
function segment(token: string): string[] | null {
  if (token.length < GLUE_MIN_LEN || GLUE_EXEMPT.has(token)) return null;

  const memo = new Map<number, string[] | null>();
  const walk = (at: number): string[] | null => {
    if (at === token.length) return [];
    const seen = memo.get(at);
    if (seen !== undefined) return seen;

    let found: string[] | null = null;
    const longest = Math.min(token.length - at, GLUE_MAX_PART_LEN);
    for (let n = longest; n >= GLUE_MIN_PART_LEN; n--) {
      const part = token.slice(at, at + n);
      if (!GLUE_PARTS.has(part)) continue;
      const rest = walk(at + n);
      if (rest) {
        found = [part, ...rest];
        break;
      }
    }
    memo.set(at, found);
    return found;
  };

  return walk(0);
}

/**
 * Three or more parts, at least two of them real-word length. The second
 * condition matters: a chain of two-letter fragments is how a real word
 * decomposes by chance, whereas deliberate gluing joins words someone would
 * otherwise have typed with spaces.
 */
function looksGlued(parts: string[]): boolean {
  return (
    parts.length >= GLUE_MIN_PARTS &&
    parts.filter((part) => part.length >= 3).length >= 2
  );
}

export function validateClue(raw: unknown): ClueCheck {
  const clue = cleanClue(raw);
  const tokens = clueTokens(clue);
  const words = tokens.filter((w) => !FREE_WORDS.has(w)).length;
  const bad = (reason: ClueReason, word: string | null = null): ClueBad => ({
    ok: false,
    reason,
    word,
    words,
  });

  if (!clue) return bad("empty");
  if (HAS_NUMBER.test(clue)) return bad("digits");

  for (const token of tokens) {
    if (isNumberWord(token)) return bad("numberWord", token);
    if (token.length > MAX_WORD_LEN) return bad("longWord", token);

    const parts = segment(token);
    if (!parts) continue;
    // A number word hiding inside a glued token is still a number word, and
    // saying so is more useful than "this looks glued together".
    const hidden = parts.find(isNumberWord);
    if (hidden) return bad("numberWord", hidden);
    if (looksGlued(parts)) return bad("gluedWord", token);
  }

  if (tokens.length > MAX_CLUE_TOKENS || words > MAX_CLUE_WORDS) {
    return bad("tooManyWords");
  }

  return { ok: true, clue, words };
}

/**
 * The i18n key and placeholders for a rejection. Returned rather than
 * rendered so this file stays free of the dictionary, and so the server can
 * render in the room's language while the client renders in the player's.
 */
export function clueErrorKey(bad: ClueBad): {
  key: string;
  vars: Record<string, string | number>;
} {
  switch (bad.reason) {
    case "empty":
      return { key: "clueEmpty", vars: {} };
    case "digits":
      return { key: "noNumbers", vars: {} };
    case "numberWord":
      return { key: "clueNumberWord", vars: { word: bad.word ?? "" } };
    case "longWord":
      return { key: "clueLongWord", vars: { word: bad.word ?? "", max: MAX_WORD_LEN } };
    case "gluedWord":
      return { key: "clueGlued", vars: { word: bad.word ?? "" } };
    case "tooManyWords":
      return { key: "clueTooMany", vars: { count: bad.words, max: MAX_CLUE_WORDS } };
  }
}
