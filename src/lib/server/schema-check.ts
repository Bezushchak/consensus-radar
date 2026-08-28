import { admin } from "../supabase/admin";

/**
 * Does the live database actually have everything this build writes to?
 *
 * This exists because of a real evening lost to the question. The Supabase SQL
 * editor runs a script as one transaction, so a single failing statement rolls
 * the whole file back — a schema.sql that dies half way leaves a database that
 * looks fine and then rejects every join, with the reason visible only in the
 * Vercel function log. Now `/api/health` names the missing piece.
 *
 * Cheap by construction: one `head` request per column, no rows fetched.
 */

const EXPECTED: Array<{ table: string; columns: string[]; optional?: true }> = [
  { table: "rooms", columns: ["code", "teams", "categories"] },
  { table: "players", columns: ["player_uid"] },
  { table: "rounds", columns: ["scale_left_ua", "scale_right_ua"] },
  { table: "player_round_stats", columns: ["player_uid"] },
  { table: "scales", columns: ["key", "category", "left_ua", "enabled"] },
  { table: "analytics_events", columns: ["session_id", "name", "props"] },
  // Optional: without it the clue screen offers no starting idea and everything
  // else plays identically, so its absence is reported but never answers 503.
  // Listed all the same, because "the hint never appears" is otherwise a silent
  // symptom with no way to tell a missing table from an unseeded one.
  { table: "scale_hints", columns: ["scale_key", "band", "lang", "text"], optional: true },
];

export interface SchemaReport {
  ok: boolean;
  missing: string[];
  /**
   * Gaps that cost a feature but not the game. Kept apart from `missing` so an
   * un-run hint seed cannot make a working deployment look broken.
   */
  degraded?: string[];
  /** What to do about it, present only when something is missing. */
  fix?: string;
}

export async function schemaReport(): Promise<SchemaReport> {
  const missing: string[] = [];
  const degraded: string[] = [];

  for (const { table, columns, optional } of EXPECTED) {
    const gaps = optional ? degraded : missing;
    const probe = await admin().from(table).select("*", { count: "exact", head: true });
    if (probe.error) {
      if (isMissingRelation(probe.error)) {
        gaps.push(`table ${table}`);
        continue;
      }
      // Anything else (permissions, connectivity) is not this check's business.
      continue;
    }

    for (const column of columns) {
      const { error } = await admin().from(table).select(column, { head: true }).limit(1);
      if (error && isMissingColumn(error)) gaps.push(`${table}.${column}`);
    }
  }

  const report: SchemaReport =
    missing.length === 0
      ? { ok: true, missing: [] }
      : {
          ok: false,
          missing,
          fix: "run supabase/schema.sql in the Supabase SQL editor, then supabase/scales-seed.sql",
        };

  return degraded.length === 0 ? report : { ...report, degraded };
}

function isMissingRelation(error: { code?: string; message: string }): boolean {
  return error.code === "42P01" || /does not exist/i.test(error.message);
}

function isMissingColumn(error: { code?: string; message: string }): boolean {
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist|schema cache/i.test(error.message)
  );
}
