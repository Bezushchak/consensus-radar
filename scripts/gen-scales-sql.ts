/**
 * Regenerates supabase/scales-seed.sql from src/lib/scales-data.ts.
 *
 *   npm run scales:sql
 *
 * The catalogue is authored in TypeScript (so the tests can check it and the
 * app has a fallback) and shipped to Postgres as a generated file. Never edit
 * the .sql by hand — edit the .ts and re-run this.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCALES } from "../src/lib/scales-data";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "supabase", "scales-seed.sql");

/** Postgres string literal: the only escape that matters is the quote. */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const duplicates = SCALES.map((s) => s.key).filter((k, i, all) => all.indexOf(k) !== i);
if (duplicates.length > 0) {
  throw new Error(`duplicate scale keys: ${duplicates.join(", ")}`);
}

const rows = SCALES.map(
  (s) =>
    `  (${q(s.key)}, ${q(s.category)}, ${q(s.l.ua)}, ${q(s.r.ua)}, ${q(s.l.en)}, ${q(s.r.en)})`
).join(",\n");

const general = SCALES.filter((s) => s.category === "general").length;
const analytics = SCALES.length - general;

const sql = `-- =====================================================================
-- Consensus Radar — scale catalogue
--
-- GENERATED FILE. Do not edit by hand: change src/lib/scales-data.ts and run
--   npm run scales:sql
--
-- ${SCALES.length} pairs (${general} general, ${analytics} analytics).
--
-- Run this in the Supabase SQL Editor after supabase/schema.sql. Safe to
-- re-run: rows are matched on \`key\`.
--
-- Note that re-running RESETS labels to the values in this file. If you edit a
-- pair from the dashboard and want to keep it, put the change in
-- src/lib/scales-data.ts too. Adding your own pairs from the dashboard is
-- safe — this file never deletes anything.
--
-- To retire a pair without losing its history, set enabled = false:
--   update public.scales set enabled = false where key = 'some_key';
-- =====================================================================

insert into public.scales (key, category, left_ua, right_ua, left_en, right_en) values
${rows}
on conflict (key) do update set
  category  = excluded.category,
  left_ua   = excluded.left_ua,
  right_ua  = excluded.right_ua,
  left_en   = excluded.left_en,
  right_en  = excluded.right_en;

-- Sanity check: how many playable pairs per category.
select category, count(*) filter (where enabled) as enabled, count(*) as total
from public.scales
group by category
order by category;
`;

writeFileSync(out, sql, "utf8");
console.log(`wrote ${out} — ${SCALES.length} pairs (${general} general, ${analytics} analytics)`);
