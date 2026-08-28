/**
 * Compiles data/scale-hints.json into supabase/scale-hints-seed.sql.
 *
 *   npm run hints:sql
 *
 * The same arrangement as the scale catalogue: authored outside Postgres,
 * shipped to it as a generated file. Never edit the .sql by hand — edit the
 * JSON (or regenerate it) and re-run this.
 *
 * This is also the gate. Every hint is re-checked against `checkHintFile` here,
 * so a string that the clue validator would reject cannot reach the database
 * even if it was hand-edited into the JSON after generation. On any problem the
 * script prints the list and writes nothing: a seed file that is half legal is
 * worse than yesterday's, because it would be loaded without anyone looking.
 */

import { writeFileSync } from "node:fs";

import { HINT_BANDS, bandRange } from "../src/lib/game/hint";
import { SCALES } from "../src/lib/scales-data";
import { SEED_FILE, checkHintFile, loadHintFile } from "./hint-file";

/** Rows per INSERT. Keeps any one statement small enough to read and to retry. */
const CHUNK = 400;

/** Postgres string literal: the only escape that matters is the quote. */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const file = loadHintFile();
const problems = checkHintFile(file, SCALES);

if (problems.length > 0) {
  console.error(`${problems.length} problem(s) in data/scale-hints.json — nothing written:\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

interface Row {
  key: string;
  band: number;
  lang: "ua" | "en";
  text: string;
}

const rows: Row[] = [];
for (const key of Object.keys(file.hints).sort()) {
  const entry = file.hints[key];
  for (const lang of ["ua", "en"] as const) {
    entry[lang].forEach((text, band) => {
      rows.push({ key, band, lang, text: text.trim() });
    });
  }
}

if (rows.length === 0) {
  console.error("data/scale-hints.json has no hints — nothing to seed.");
  process.exit(1);
}

const chunks: string[] = [];
for (let i = 0; i < rows.length; i += CHUNK) {
  const values = rows
    .slice(i, i + CHUNK)
    .map((r) => `  (${q(r.key)}, ${r.band}, ${q(r.lang)}, 0, ${q(r.text)})`)
    .join(",\n");
  chunks.push(
    `insert into public.scale_hints (scale_key, band, lang, variant, text) values\n${values}\n` +
      `on conflict (scale_key, band, lang, variant) do update set text = excluded.text;`
  );
}

const pairs = Object.keys(file.hints).length;
const bandList = Array.from({ length: HINT_BANDS }, (_, b) => {
  const { min, max } = bandRange(b);
  return `${b} = ${min}-${max}`;
}).join(", ");

const sql = `-- =====================================================================
-- Consensus Radar — clue hints
--
-- GENERATED FILE. Do not edit by hand: change data/scale-hints.json and run
--   npm run hints:sql
--
-- ${rows.length} rows: ${pairs} scale pair(s) x ${HINT_BANDS} bands x 2 languages.
-- Authored ${file.generated}${file.model ? ` by ${file.model}` : ""}.
--
-- \`band\` is the fifth of the dial the target sits in: ${bandList}.
--
-- OPTIONAL. Run this in the Supabase SQL Editor after supabase/schema.sql if
-- you want the clue screen to offer a starting idea. Skipping it leaves the game
-- exactly as it plays today — one small line of the clue screen is simply absent.
--
-- Safe to re-run: rows are matched on (scale_key, band, lang, variant), and
-- nothing is ever deleted. Retiring a pair's hints is a manual step:
--   delete from public.scale_hints where scale_key = 'some_key';
--
-- Every string here has been through the game's own clue validator, so no hint
-- contains a number in any form — a suggestion the input box would then reject
-- would be worse than no suggestion at all.
-- =====================================================================

${chunks.join("\n\n")}

-- Sanity check: bands filled per language. \`per_pair\` should read ${HINT_BANDS}.
-- (\`rows\` is a reserved word in Postgres, hence the alias.)
select
  lang,
  count(distinct scale_key)                      as pairs,
  count(*)                                       as hint_rows,
  round(count(*)::numeric / greatest(count(distinct scale_key), 1), 1) as per_pair
from public.scale_hints
group by lang
order by lang;
`;

writeFileSync(SEED_FILE, sql, "utf8");
console.log(`wrote ${SEED_FILE} — ${rows.length} rows across ${pairs} pair(s)`);
