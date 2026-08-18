/**
 * Server-side scale source.
 *
 * A running game deals its pairs from the `public.scales` table, so the
 * catalogue can be extended or reworded from the Supabase dashboard without a
 * deploy. The table is read at most once every few minutes per server
 * instance — a round opening never waits on a cold query more than that — and
 * if the table is empty or unreachable the built-in catalogue takes over, so a
 * missing seed degrades into "fewer pairs" rather than a broken game.
 */

import { admin } from "../supabase/admin";
import { filterByCategories, isCategory, type Scale } from "../scales";
import { SCALES } from "../scales-data";

const TTL_MS = 5 * 60 * 1000;

interface ScaleRow {
  key: string;
  category: string;
  left_ua: string;
  right_ua: string;
  left_en: string;
  right_en: string;
}

let cache: { at: number; scales: Scale[]; source: "db" | "builtin" } | null = null;

function toScale(row: ScaleRow): Scale | null {
  if (!row.key || !isCategory(row.category)) return null;
  if (!row.left_ua || !row.right_ua || !row.left_en || !row.right_en) return null;
  return {
    key: row.key,
    category: row.category,
    l: { ua: row.left_ua, en: row.left_en },
    r: { ua: row.right_ua, en: row.right_en },
  };
}

async function readTable(): Promise<Scale[] | null> {
  const { data, error } = await admin()
    .from("scales")
    .select("key, category, left_ua, right_ua, left_en, right_en")
    .eq("enabled", true);

  // A missing table, a typo in a label, an empty seed — all of them mean
  // "fall back", never "fail the round".
  if (error || !data) return null;

  const scales = (data as ScaleRow[])
    .map(toScale)
    .filter((s): s is Scale => s !== null);
  return scales.length > 0 ? scales : null;
}

/** Every enabled pair, from the database when it has any. */
export async function allScales(): Promise<Scale[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.scales;

  let fromDb: Scale[] | null = null;
  try {
    fromDb = await readTable();
  } catch {
    fromDb = null;
  }

  cache = fromDb
    ? { at: now, scales: fromDb, source: "db" }
    : { at: now, scales: SCALES, source: "builtin" };
  return cache.scales;
}

/** The pool a room should draw from, narrowed to its chosen categories. */
export async function scalePool(categories: string[]): Promise<Scale[]> {
  return filterByCategories(await allScales(), categories);
}

/** Where the current pool came from and how big it is — used by /api/health. */
export async function scaleSource(): Promise<{ source: "db" | "builtin"; count: number }> {
  const scales = await allScales();
  return { source: cache?.source ?? "builtin", count: scales.length };
}

/** Drops the cache. Called after nothing in production; handy in tests. */
export function forgetScales(): void {
  cache = null;
}
