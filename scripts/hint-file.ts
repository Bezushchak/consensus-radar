/**
 * The hint catalogue file: its shape, and every rule a hint has to obey.
 *
 * `data/scale-hints.json` is the only authoring artifact for the clue hints.
 * Deliberately a JSON file at the repo root and not a TypeScript module under
 * `src/lib` the way the scale catalogue is, for two reasons that both matter:
 *
 *   - a module under `src` can be imported by a client component, and a hint
 *     tells you which fifth of the dial the target is in. One careless import
 *     and the whole room can read the answer out of the JavaScript bundle.
 *   - 262 pairs x 5 bands x 2 languages is a couple of hundred kilobytes of
 *     prose that no page needs. As a data file read by scripts it never reaches
 *     a browser at all.
 *
 * So the flow is: `gen-scale-hints.ts` writes this file, `gen-hints-sql.ts`
 * compiles it to `supabase/scale-hints-seed.sql`, and the running app only ever
 * reads the table. This module is the one definition of "is this hint legal",
 * shared by the generator (which retries on a rejection), the SQL compiler
 * (which refuses to emit a bad row) and `tests/hints.test.ts` (which is what
 * makes the rule real).
 *
 * The rules, and why each one is here:
 *
 *   1. It has to pass `validateClue` — the actual validator the game runs, not
 *      a copy of its intent. A hint is a candidate clue: the player may well
 *      type it in verbatim, and a suggestion the input box then rejects in red
 *      is worse than no suggestion at all. This is what enforces "no numbers"
 *      in every form the validator knows: digits, spelled-out numbers, welded
 *      numerals, vague ones, percentages, ordinals, `half`, `пів`.
 *   2. It must not contain either pole label. "Quite hot" for the hot/cold
 *      scale tells the clue-giver nothing they cannot read off the screen, and
 *      it is the failure mode a model falls into most.
 *   3. The five bands of one pair must differ from each other. Two identical
 *      hints mean at least one band was not really answered.
 *   4. It must say something concrete. A phrase built only out of degree words
 *      — "very slightly", "майже зовсім" — is rule 2 wearing a hat.
 *   5. Short. A hint longer than a clue is a paragraph, and nobody reads a
 *      paragraph with a phase clock running.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateClue, clueTokens } from "../src/lib/game/clue";
import { FREE_WORDS } from "../src/lib/game/clue-words";
import { HINT_BANDS, bandRange } from "../src/lib/game/hint";
import type { Scale } from "../src/lib/scales";

const here = dirname(fileURLToPath(import.meta.url));

/** The authoring file. */
export const HINT_FILE = join(here, "..", "data", "scale-hints.json");
/** The generated seed. */
export const SEED_FILE = join(here, "..", "supabase", "scale-hints-seed.sql");

/** Long enough for a real phrase, short enough to read in one glance. */
export const MAX_HINT_CHARS = 64;

/**
 * Degree words. Not a rejection on their own — "lukewarm, almost cold tea"
 * would be fine — only when a hint is made of nothing else.
 */
const DEGREE_WORDS = new Set([
  // en
  "very", "quite", "rather", "fairly", "pretty", "slightly", "somewhat", "mildly",
  "barely", "hardly", "almost", "nearly", "totally", "utterly", "completely",
  "extremely", "really", "super", "kind", "sort", "bit", "little", "lot", "much",
  "more", "less", "most", "least", "too", "so", "just", "about", "around",
  "roughly", "maybe", "perhaps", "still", "even", "way", "far", "close", "closer",
  "closest", "middle", "mid", "centre", "center", "edge", "end", "left", "right",
  "top", "bottom", "start", "finish", "beginning", "side", "point", "spot",
  // ua
  "дуже", "досить", "доволі", "трохи", "трішки", "майже", "зовсім", "цілком",
  "повністю", "абсолютно", "надто", "занадто", "ледве", "приблизно", "десь",
  "можливо", "мабуть", "більше", "менше", "найбільше", "найменше", "ближче",
  "далі", "далеко", "близько", "посередині", "середина", "серединка", "край",
  "краю", "початок", "початку", "кінець", "кінця", "ліво", "ліворуч", "право",
  "праворуч", "бік", "боку", "точка", "точці", "місце", "місці",
]);

/** One pair's ideas: index = band, five entries per language, no gaps. */
export interface HintEntry {
  ua: string[];
  en: string[];
}

export interface HintFileShape {
  /**
   * What this file is, in one line, for whoever opens `data/` and finds a
   * megabyte of JSON. Preserved across regenerations — JSON has no comments, so
   * this is the only place the explanation can live.
   */
  note?: string;
  /** ISO date of the last write, for the header of the generated SQL. */
  generated: string;
  /** Which model wrote it, so a regeneration can be compared. */
  model?: string;
  /** Keyed by scale key. A pair with no entry simply has no hints. */
  hints: Record<string, HintEntry>;
}

const DEFAULT_NOTE =
  "Clue hints, one per scale pair per band (0=0-19 … 4=80-100) per language. " +
  "Generated by scripts/gen-scale-hints.ts, compiled to SQL by scripts/gen-hints-sql.ts.";

export function emptyHintFile(): HintFileShape {
  return {
    note: DEFAULT_NOTE,
    generated: new Date().toISOString().slice(0, 10),
    hints: {},
  };
}

export function loadHintFile(path: string = HINT_FILE): HintFileShape {
  if (!existsSync(path)) return emptyHintFile();
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error(`${path} is not an object`);
  const file = raw as Partial<HintFileShape>;
  if (!file.hints || typeof file.hints !== "object") throw new Error(`${path} has no "hints"`);
  return {
    note: typeof file.note === "string" ? file.note : DEFAULT_NOTE,
    generated: typeof file.generated === "string" ? file.generated : emptyHintFile().generated,
    ...(typeof file.model === "string" ? { model: file.model } : {}),
    hints: file.hints as Record<string, HintEntry>,
  };
}

/** Written sorted by key, so a regenerated file diffs pair by pair. */
export function saveHintFile(file: HintFileShape, path: string = HINT_FILE): void {
  const hints: Record<string, HintEntry> = {};
  for (const key of Object.keys(file.hints).sort()) hints[key] = file.hints[key];
  writeFileSync(path, `${JSON.stringify({ ...file, hints }, null, 2)}\n`, "utf8");
}

/**
 * Why this one string is not allowed to be a hint, or null when it is fine.
 *
 * The message is written to be pasted straight into a retry prompt, so it names
 * the offending word rather than the rule number.
 */
export function checkHint(
  text: string,
  poles: string[] = []
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_HINT_CHARS) {
    return `too long (${trimmed.length} characters, max ${MAX_HINT_CHARS})`;
  }

  // Rule 1: the real validator, so the hint is something the player could send.
  const check = validateClue(trimmed);
  if (!check.ok) {
    return check.word
      ? `rejected by the clue validator as ${check.reason}: “${check.word}”`
      : `rejected by the clue validator as ${check.reason}`;
  }

  const tokens = clueTokens(trimmed);

  // Rule 2: no pole labels. Compared token by token rather than by substring,
  // so "hot" is caught in "hot tea" but "hotel" is not caught at all. Free words
  // and two-letter fragments are dropped from the comparison first, or a pole
  // like "Може почекати" would ban the word "може" from every hint on the scale.
  const poleTokens = new Set(
    poles
      .flatMap((p) => clueTokens(p))
      .filter((tok) => tok.length > 2 && !FREE_WORDS.has(tok))
  );
  const echoed = tokens.find((tok) => poleTokens.has(tok));
  if (echoed) return `repeats the pole label “${echoed}”`;

  // Rule 4: something concrete, not only degree.
  const meaningful = tokens.filter((tok) => !FREE_WORDS.has(tok));
  if (meaningful.length > 0 && meaningful.every((tok) => DEGREE_WORDS.has(tok))) {
    return "says only how much, not what — needs a concrete image";
  }

  return null;
}

/**
 * Every problem with one pair's entry, as human sentences.
 *
 * `entry` is typed loosely and re-checked from scratch because it comes out of
 * `JSON.parse` — the declared interface is a promise about what the generator
 * writes, not a fact about the file on disk.
 */
export function checkEntry(key: string, entry: unknown, scale: Scale | undefined): string[] {
  const problems: string[] = [];
  if (!scale) {
    problems.push(`${key}: no such scale in the catalogue`);
    return problems;
  }
  if (!entry || typeof entry !== "object") {
    problems.push(`${key}: not an object`);
    return problems;
  }

  for (const lang of ["ua", "en"] as const) {
    const raw = (entry as Record<string, unknown>)[lang];
    if (!Array.isArray(raw) || raw.length !== HINT_BANDS) {
      const got = Array.isArray(raw) ? raw.length : 0;
      problems.push(`${key}.${lang}: expected ${HINT_BANDS} hints, got ${got}`);
      continue;
    }

    const list = raw.map((text) => String(text ?? ""));
    const poles = [scale.l[lang], scale.r[lang]];

    list.forEach((text, band) => {
      const why = checkHint(text, poles);
      const { min, max } = bandRange(band);
      if (why) problems.push(`${key}.${lang}[${min}-${max}]: ${why} — “${text}”`);
    });

    // Rule 3: five bands, five different ideas.
    const seen = new Map<string, number>();
    list.forEach((text, band) => {
      const norm = clueTokens(text).join(" ");
      const first = seen.get(norm);
      if (first !== undefined) {
        problems.push(`${key}.${lang}: bands ${first} and ${band} say the same thing — “${text}”`);
      } else {
        seen.set(norm, band);
      }
    });
  }

  return problems;
}

/** Every problem in the whole file. Empty means the file is shippable. */
export function checkHintFile(file: HintFileShape, scales: readonly Scale[]): string[] {
  const byKey = new Map(scales.map((s) => [s.key, s]));
  return Object.entries(file.hints).flatMap(([key, entry]) =>
    checkEntry(key, entry, byKey.get(key))
  );
}
