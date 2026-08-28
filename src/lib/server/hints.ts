/**
 * Server-side hint source.
 *
 * Reads `public.scale_hints` for one scale pair and hands back the idea written
 * for the band the target sits in. Structured like `server/scales.ts` — cached
 * with a TTL, and every failure path degrades to `null` rather than throwing —
 * but with one difference that matters: there is no built-in fallback. An empty
 * or missing table means the clue screen offers no starting idea, which is one
 * optional line of UI absent. A missing *scale* would end the round, which is
 * why that file carries a code catalogue and this one does not.
 *
 * Fetches by key rather than loading the whole table. 262 pairs x 5 bands x 2
 * languages is ~2600 rows, comfortably past PostgREST's default 1000-row
 * ceiling, and a silently truncated read is the kind of bug that shows up as
 * "hints work for the first half of the alphabet". Per key it is ten rows, and
 * the clue-giver's client asks once per round.
 *
 * Nothing in `src/components` or `src/lib/client` may import this file. The
 * hint names the fifth of the dial the target is in, so it travels only through
 * GET /api/rooms/:code/secret, which already refuses everyone but the round's
 * clue-giver. `tests/hints.test.ts` asserts that at the source level.
 */

import { admin } from "../supabase/admin";
import { HINT_BANDS, pickHint, type HintText } from "../game/hint";

const TTL_MS = 10 * 60 * 1000;

interface HintRow {
  band: number;
  lang: string;
  variant: number;
  text: string;
}

/** band index -> the complete variants written for it. */
type HintsByBand = HintText[][];

const cache = new Map<string, { at: number; bands: HintsByBand }>();

/**
 * Rows to bands, keeping only variants that exist in *both* languages.
 *
 * Strict on purpose. A half-filled variant is a generation bug, and the two
 * ways of tolerating it are both worse than dropping it: showing a Ukrainian
 * sentence to an English player is confusing, and showing a hint to one half of
 * the room and not the other makes the feature look broken rather than absent.
 */
function group(rows: HintRow[]): HintsByBand {
  const byBand: Array<Map<number, Partial<HintText>>> = [];
  for (let b = 0; b < HINT_BANDS; b++) byBand.push(new Map());

  for (const row of rows) {
    const band = Number(row.band);
    if (!Number.isInteger(band) || band < 0 || band >= HINT_BANDS) continue;

    const lang: string = row.lang;
    if (lang !== "ua" && lang !== "en") continue;

    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;

    const variants = byBand[band];
    const variant = Number.isInteger(Number(row.variant)) ? Number(row.variant) : 0;
    const entry = variants.get(variant) ?? {};
    entry[lang] = text;
    variants.set(variant, entry);
  }

  return byBand.map((variants) =>
    [...variants.entries()]
      // Sorted by variant number so the seeded pick below is stable across
      // reads — Postgres makes no promise about row order without an ORDER BY,
      // and an unstable order would reshuffle the hint on every cache miss.
      .sort((a, b) => a[0] - b[0])
      .map(([, entry]) => entry)
      .filter((entry): entry is HintText => Boolean(entry.ua && entry.en))
  );
}

async function readKey(scaleKey: string): Promise<HintsByBand> {
  const { data, error } = await admin()
    .from("scale_hints")
    .select("band, lang, variant, text")
    .eq("scale_key", scaleKey);

  // A missing table, an un-run seed, a pair nobody wrote hints for — all of
  // them mean "no idea to offer", never "fail the round".
  if (error || !data) return group([]);
  return group(data as HintRow[]);
}

/**
 * The idea for this pair and this band, or null when there isn't one.
 *
 * `seed` is the round id: it decides which variant a band with several offers,
 * and being derived from the round keeps the sentence still while the player
 * stares at it. Only variant 0 is seeded today, so today it decides nothing.
 */
export async function hintFor(
  scaleKey: string,
  band: number,
  seed: string
): Promise<HintText | null> {
  if (!scaleKey) return null;
  if (!Number.isInteger(band) || band < 0 || band >= HINT_BANDS) return null;

  const now = Date.now();
  const hit = cache.get(scaleKey);
  let bands = hit && now - hit.at < TTL_MS ? hit.bands : null;

  if (!bands) {
    try {
      bands = await readKey(scaleKey);
    } catch {
      bands = group([]);
    }
    cache.set(scaleKey, { at: now, bands });
  }

  return pickHint(bands[band] ?? [], seed);
}

/**
 * How many hint rows exist at all — the answer to "did I run the seed?", which
 * is otherwise invisible: a deployment with no hints looks exactly like one
 * where the feature was never built.
 *
 * A head request with an exact count, so no rows cross the wire and the number
 * is not silently capped at PostgREST's page size the way a `select` would be.
 * Zero on any error, because this is a diagnostic and must never be the reason
 * /api/health fails.
 */
export async function hintRowCount(): Promise<number> {
  try {
    const { count, error } = await admin()
      .from("scale_hints")
      .select("*", { count: "exact", head: true });
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** Drops the cache. Called after nothing in production; handy in tests. */
export function forgetHints(): void {
  cache.clear();
}
