/**
 * What a clue is allowed to say. Pure, so the same function decides on the
 * server and in the input box — the client cannot be more permissive than the
 * server, and cannot be stricter either, which is the failure mode that
 * teaches players to distrust the form.
 *
 * Three rules, in order of how deterministic they are:
 *
 *   1. No numbers. Digits are the obvious half; the harder half is numbers
 *      spelled out ("forty", "п'ятдесят") and numbers hidden inside a word
 *      ("level5", "тридцятьвідсотків").
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
 * Known gaps, left open knowingly. ASCII Roman numerals are not enforced,
 * because `MIX`, `CD`, `XL` and `VI` are valid Roman numerals and also real
 * words, and `I` is a pronoun — the false rejections would cost more than the
 * evasion. The Unicode Roman numerals (Ⅰ Ⅴ Ⅹ) *are* caught, because they sit
 * in a number category.
 */

import { cleanClue } from "./engine";
import {
  FREE_WORDS,
  GLUE_EXEMPT,
  GLUE_PARTS,
  NUMBER_EXEMPT,
  NUMBER_STEMS,
  NUMBER_WORDS,
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

function isNumberWord(word: string): boolean {
  if (NUMBER_EXEMPT.has(word)) return false;
  if (NUMBER_WORDS.has(word)) return true;
  return NUMBER_STEMS.some((stem) => word.startsWith(stem));
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
