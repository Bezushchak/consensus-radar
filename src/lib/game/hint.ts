/**
 * Which fifth of the dial is the target in, and which pre-written idea belongs
 * to it.
 *
 * The clue-giver sees a target like 73 and has to invent a phrase that means
 * "roughly there" without naming a number. That is the hardest ten seconds in
 * the game, and it is the reason a first-time player freezes. So every scale
 * pair carries five ideas per language — one per band — written ahead of time
 * and stored in `public.scale_hints`. Nothing is generated during a round: the
 * phase clock is running, an API call could stall it, and a live model would
 * happily hand back "about seventy percent", which `validateClue` then rejects
 * in front of the player. Pre-written text is checked once, by the same
 * validator, before it ever reaches the database.
 *
 * Pure on purpose. This file is what the tests hold still: five bands, fixed
 * boundaries, and a pick that depends only on its arguments. Reading the rows
 * is `src/lib/server/hints.ts`; the hint reaches exactly one player through
 * GET /api/rooms/:code/secret, which already refuses everyone but the round's
 * clue-giver — and it has to stay that way, because a hint written for band 3
 * gives the answer away to within twenty points.
 *
 * On the width: five bands of twenty is a deliberate ceiling, not a first
 * guess. The scoring pays 5 for landing within 5 and 3 for within 12, so a hint
 * read perfectly still only bullseyes about half the time. Ten bands would not
 * fix that — language runs out of resolution somewhere around ten points, and
 * "quite warm" versus "fairly warm" is not a distinction a team can act on.
 * The hint is a way in, not an answer.
 */

/** Bands per scale: 0-19, 20-39, 40-59, 60-79, 80-100. */
export const HINT_BANDS = 5;

/**
 * One idea, in both languages.
 *
 * Both, always, because the UI language is a per-device choice (`useLang`) and
 * not a property of the room — the same round can be looked at in Ukrainian on
 * one phone and English on another, exactly as the pole labels already are. So
 * the server sends the pair and the client picks, and this type lives in the
 * pure module rather than in `server/hints.ts` so that client code can name it
 * without importing anything server-side.
 */
export interface HintText {
  ua: string;
  en: string;
}

/**
 * The band a target belongs to.
 *
 * Note the top band is twenty-one wide (80-100) rather than twenty, because the
 * dial is inclusive at both ends: 100 is a legal target and there is no sixth
 * band for it to fall into. Anything outside 0-100 is clamped rather than
 * rejected — a band is a lookup key, and throwing here would take the round
 * down over a cosmetic feature.
 */
export function bandOf(target: number): number {
  const rounded = Math.round(target);
  // NaN is the one input the clamp below cannot catch: `Math.max(0, NaN)` is
  // NaN, not 0, so it would travel all the way out as a band index. Nothing
  // reachable passes one today — the target is an integer column and the clue
  // screen checks for null first — but the promise above is that a band comes
  // back, and a NaN band would reach Postgres as `band=eq.NaN` and be rejected
  // there instead, which is a wasted request and a log line about nothing.
  if (Number.isNaN(rounded)) return 0;
  const clamped = Math.min(100, Math.max(0, rounded));
  return Math.min(HINT_BANDS - 1, Math.floor(clamped / 20));
}

/** Human bounds of a band, for docs and tests rather than for gameplay. */
export function bandRange(band: number): { min: number; max: number } {
  const truncated = Math.trunc(band);
  // Same hole, same reason — and the two must agree, or `bandOf` and the bounds
  // it is checked against would disagree about what band 0 means.
  const b = Number.isNaN(truncated)
    ? 0
    : Math.min(HINT_BANDS - 1, Math.max(0, truncated));
  return { min: b * 20, max: b === HINT_BANDS - 1 ? 100 : b * 20 + 19 };
}

/**
 * One item out of however many a band carries — a string during authoring, a
 * `{ua, en}` pair once the server has matched the two languages up.
 *
 * Seeded rather than random so that a re-render, a reconnect or a second tab
 * shows the same player the same sentence — a hint that reshuffles on every
 * poll would read as a bug. The seed is the round id, so the same pair in a
 * later round can offer a different idea.
 *
 * Only variant 0 is seeded today, which makes this function a no-op in
 * practice. It exists now because the alternative is discovering later that the
 * choice was made at the call site in three places.
 */
export function pickHint<T>(hints: T[], seed: string): T | null {
  if (hints.length === 0) return null;
  if (hints.length === 1) return hints[0];
  return hints[hashSeed(seed) % hints.length];
}

/**
 * FNV-1a, 32-bit. Small, dependency-free, and stable across runtimes — which
 * matters more here than distribution quality, because the alternative
 * (`Math.random`) is exactly the flicker described above.
 */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
