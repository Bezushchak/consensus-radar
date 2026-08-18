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

const EXPECTED: Array<{ table: string; columns: string[] }> = [
  { table: "rooms", columns: ["code", "teams", "categories"] },
  { table: "players", columns: ["player_uid"] },
  { table: "rounds", columns: ["scale_left_ua", "scale_right_ua"] },
  { table: "player_round_stats", columns: ["player_uid"] },
  { table: "scales", columns: ["key", "category", "left_ua", "enabled"] },
  { table: "analytics_events", columns: ["session_id", "name", "props"] },
];

export interface SchemaReport {
  ok: boolean;
  missing: string[];
  /** What to do about it, present only when something is missing. */
  fix?: string;
}

export async function schemaReport(): Promise<SchemaReport> {
  const missing: string[] = [];

  for (const { table, columns } of EXPECTED) {
    const probe = await admin().from(table).select("*", { count: "exact", head: true });
    if (probe.error) {
      if (isMissingRelation(probe.error)) {
        missing.push(`table ${table}`);
        continue;
      }
      // Anything else (permissions, connectivity) is not this check's business.
      continue;
    }

    for (const column of columns) {
      const { error } = await admin().from(table).select(column, { head: true }).limit(1);
      if (error && isMissingColumn(error)) missing.push(`${table}.${column}`);
    }
  }

  return missing.length === 0
    ? { ok: true, missing: [] }
    : {
        ok: false,
        missing,
        fix: "run supabase/schema.sql in the Supabase SQL editor, then supabase/scales-seed.sql",
      };
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
