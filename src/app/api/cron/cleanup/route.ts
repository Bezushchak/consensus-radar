import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/server/http";
import { admin, isConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/cleanup — throws away rooms nobody came back to, and analytics
 * rows older than a quarter.
 *
 * Both deletions are already written, as `security definer` functions in
 * supabase/schema.sql, revoked from `anon` and `authenticated`. This route only
 * calls them, which is why it is a handful of lines rather than a migration:
 * the rules about what may be deleted stay next to the tables they delete from,
 * and this stays a trigger.
 *
 * WHY IT EXISTS AT ALL. Rooms are ephemeral by design — a code, some names, a
 * dozen rounds — and nothing in the game ever removes one. The durable results
 * were copied into `game_results` and `player_round_stats` the moment the game
 * finished, so a week-old room is pure residue: rows that cost storage, make
 * `select *` slower, and keep a four-letter code out of circulation. There are
 * only 31^4 codes.
 *
 * WHAT IT WILL NOT DELETE. `game_results` and `player_round_stats` are never
 * touched, so the leaderboard is unaffected by any of this. Neither is a room
 * somebody is still using: `updated_at` moves on every mutation, so the cutoff
 * is measured from the last thing that happened in the room, not from when it
 * was created. A game running for eight hours is safe.
 *
 * SECURITY. The service-role key is in this process, so an open URL here would
 * be an unauthenticated delete-everything button. It is gated on `CRON_SECRET`,
 * which Vercel sends as `Authorization: Bearer <secret>` on every cron
 * invocation of a project that has the variable set. Missing variable means the
 * route refuses everything — closed by default, so a deploy that forgets the
 * secret loses the cleanup rather than exposing it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — cleanup is disabled" },
      { status: 503, headers: NO_STORE }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured" },
      { status: 503, headers: NO_STORE }
    );
  }

  // Independent on purpose. An un-migrated database may have one function and
  // not the other, and a missing function must not cost the cleanup that does
  // exist — so each is reported on its own and neither can fail the request.
  const [rooms, events] = await Promise.all([
    purge("purge_stale_rooms", { older_than: "48 hours" }),
    purge("purge_old_events", { older_than: "90 days" }),
  ]);

  return NextResponse.json({ ok: true, rooms, events }, { headers: NO_STORE });
}

type Outcome = { deleted: number } | { error: string };

async function purge(fn: string, args: Record<string, string>): Promise<Outcome> {
  try {
    const { data, error } = await admin().rpc(fn, args);
    if (error) {
      console.warn(`[cleanup] ${fn} failed: ${error.message}`);
      return { error: error.message };
    }
    // The functions return the row count as a bare int.
    const n = Number(data);
    return { deleted: Number.isFinite(n) ? n : 0 };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[cleanup] ${fn} threw: ${message}`);
    return { error: message };
  }
}
