/**
 * Scale types and the pure helpers that both sides of the app share.
 *
 * The catalogue itself lives in `scales-data.ts` and is imported only by the
 * server (round generation) and the seed generator — the browser gets its
 * pole labels from the round row instead, so a few hundred pairs never ship
 * to the client.
 */

export type Category = "general" | "analytics";
export type Lang = "ua" | "en";

export interface Scale {
  key: string;
  category: Category;
  l: Record<Lang, string>;
  r: Record<Lang, string>;
}

export const CATEGORIES: readonly Category[] = ["general", "analytics"];

export function isCategory(value: unknown): value is Category {
  return value === "general" || value === "analytics";
}

/**
 * Narrows a pool to the chosen categories. An empty result means the caller
 * asked for something that does not exist, so the whole pool is returned
 * rather than leaving the game with nothing to play.
 */
export function filterByCategories(pool: Scale[], categories: string[]): Scale[] {
  const wanted = new Set(categories);
  const picked = pool.filter((s) => wanted.has(s.category));
  return picked.length > 0 ? picked : pool;
}

/** The four label columns a round carries, so it can be read years later. */
export interface StoredLabels {
  scale_left: string;
  scale_right: string;
  scale_left_ua: string | null;
  scale_right_ua: string | null;
}

/**
 * Pole labels for a round in the reader's language.
 *
 * Rounds store both languages, so rewording or retiring a pair never changes
 * how an old game reads. Rounds recorded before the UA columns existed fall
 * back to the English labels.
 */
export function storedLabels(round: StoredLabels, lang: Lang): { left: string; right: string } {
  if (lang === "ua" && round.scale_left_ua && round.scale_right_ua) {
    return { left: round.scale_left_ua, right: round.scale_right_ua };
  }
  return { left: round.scale_left, right: round.scale_right };
}
