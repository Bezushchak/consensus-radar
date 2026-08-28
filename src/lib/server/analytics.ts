/**
 * Product analytics: ingest and reporting.
 *
 * The whole feature is one append-only table plus two questions asked of it:
 * where do people stop (conversion, drop-off) and what do they touch (clicks).
 *
 * Three rules the ingest end keeps:
 *
 *   1. The event name has to be on the allowlist below. A tracking endpoint
 *      that accepts any string is a public write-anything table, and the first
 *      person to find it will fill the quota for fun.
 *   2. Props are clamped — a handful of small keys, no nesting, length capped.
 *      Nothing here needs a big payload and the cap is what makes the table
 *      cheap to keep.
 *   3. Nothing personal. No IP, no user agent, no cursor trail. `session_id`
 *      is random per tab and `player_uid` is the same non-credential device id
 *      the leaderboard already groups by, so this answers "how many people"
 *      without answering "which person".
 *
 * A write failure is never allowed to affect a game: `record` swallows its
 * errors and logs them.
 */

import { admin } from "../supabase/admin";
import { forward } from "./mixpanel";
import { ApiError } from "./rooms";

/**
 * The funnel, in the order a player meets it. Position matters — it is what
 * makes conversion and drop-off computable — so append rather than reorder.
 */
export const FUNNEL = [
  "app_open", // landed on the front page
  "create_open", // started filling in the host form
  "room_created", // room exists
  "joined", // a second device is in the room
  "game_started", // host pressed start
  "clue_sent", // a clue-giver wrote a clue
  "guess_locked", // somebody actually played a round
  "round_revealed", // a round completed
  "game_finished", // somebody reached the goal
] as const;

/** Events that are useful but not steps: they never gate a later stage. */
const SIDE_EVENTS = [
  "join_open", // saw the join screen (may or may not join)
  "leaderboard_open",
  // Opened one leaderboard entry. Against `leaderboard_open` it answers the
  // only question the podium rework raises: does anybody look past the top of
  // the list. `props.board` says which of the four is worth drilling into and
  // `props.rank` says whether people open the winner or hunt for their own row
  // — if the ranks clustered at 1..3 the table below the podium is dead weight.
  "lb_row_open", // props.board, props.rank
  // Opened the tutorial. Not a funnel step on purpose: reading the rules is
  // not on the way to playing, and a step nobody has to take would read as a
  // 90% drop-off. It is worth knowing on its own, though — against `app_open`
  // it says how many people do not trust the game to explain itself.
  "howto_open",
  "lang_switched",
  "bet_placed",
  // The two rescue hatches. Both are failure signals rather than features, and
  // that is exactly why they are worth counting: `round_skipped` against
  // `round_revealed` says how often a scale or a clue-giver defeats a table,
  // and `host_claimed` against `room_created` says how often the person who
  // opened the room walked away from it. If either climbs, the fix is upstream
  // — a better scale pool, a clearer clue screen — not a better button.
  "round_skipped", // props.round, props.phase
  "host_claimed",
  // A phase clock ran out. Sits next to `round_skipped` because it measures the
  // same thing from the other side: how often a table cannot finish a phase
  // under its own steam. `props.phase` is what makes it useful — "clue" says
  // the clue screen is too hard or the limit too tight, "guess" says people are
  // not noticing that it is their turn. Only fires in rooms that chose a clock,
  // so the denominator is never `round_revealed` across all rooms.
  "timer_expired", // props.round, props.phase
  "click", // props.target = the data-ev label
  "pointer_heat", // sampled cursor grid, off unless enabled
  "error_shown", // props.message
  "session_end", // props.seconds = time on page
] as const;

const ALLOWED = new Set<string>([...FUNNEL, ...SIDE_EVENTS]);

export type FunnelStep = (typeof FUNNEL)[number];

const MAX_BATCH = 40;
const MAX_PROP_KEYS = 8;
const MAX_STR = 120;

export interface IncomingEvent {
  name?: unknown;
  path?: unknown;
  roomCode?: unknown;
  props?: unknown;
  ts?: unknown;
}

export interface EventRow {
  session_id: string;
  player_uid: string | null;
  room_code: string | null;
  name: string;
  path: string | null;
  props: Record<string, string | number | boolean>;
  lang: string | null;
  device: string | null;
  ts: string;
}

export interface Envelope {
  sessionId?: unknown;
  uid?: unknown;
  lang?: unknown;
  device?: unknown;
  events?: unknown;
}

/**
 * Turns one posted batch into rows. Unknown event names are dropped silently
 * rather than failing the batch: a stale browser tab from an older deploy is
 * not an error worth surfacing to a player mid-game.
 */
export function buildRows(body: Envelope): EventRow[] {
  const sessionId = str(body.sessionId, 64);
  if (!sessionId) throw new ApiError(400, "sessionId is required");

  const uid = /^[0-9a-f]{32}$/.test(String(body.uid ?? "")) ? String(body.uid) : null;
  const lang = body.lang === "en" ? "en" : body.lang === "ua" ? "ua" : null;
  const device = body.device === "mobile" ? "mobile" : body.device === "desktop" ? "desktop" : null;

  const list = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const rows: EventRow[] = [];

  for (const raw of list as IncomingEvent[]) {
    const name = str(raw?.name, 40);
    if (!name || !ALLOWED.has(name)) continue;

    rows.push({
      session_id: sessionId,
      player_uid: uid,
      room_code: roomCode(raw?.roomCode),
      name,
      path: str(raw?.path, MAX_STR),
      props: cleanProps(raw?.props),
      lang,
      device,
      ts: timestamp(raw?.ts),
    });
  }

  return rows;
}

export async function record(body: Envelope): Promise<{ accepted: number; mirrored: number }> {
  const rows = buildRows(body);
  if (rows.length === 0) return { accepted: 0, mirrored: 0 };

  // Our own table and the Mixpanel mirror are independent: one being down must
  // not cost us the other, so both run and neither can reject the batch.
  const [stored, mirrored] = await Promise.all([store(rows), forward(rows)]);
  return { accepted: stored, mirrored: mirrored.sent };
}

async function store(rows: EventRow[]): Promise<number> {
  const { error } = await admin().from("analytics_events").insert(rows);
  if (error) {
    // Analytics must never break the game, and a missing table is a setup
    // problem, not a request problem. Log and shrug.
    console.warn("[analytics] dropped a batch:", error.message);
    return 0;
  }
  return rows.length;
}

// ---------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------

export type Period = "day" | "week" | "month" | "all";

const MAX_ROWS = 20000;

function since(period: Period): string | null {
  if (period === "all") return null;
  const days = period === "day" ? 1 : period === "week" ? 7 : 30;
  return new Date(Date.now() - days * 86400000).toISOString();
}

export interface FunnelRow {
  step: string;
  sessions: number;
  events: number;
  /** Share of the first step, 0..100. */
  conversion: number | null;
  /** Share of the previous step that did not get here, 0..100. */
  dropoff: number | null;
}

export interface ClickRow {
  target: string;
  path: string | null;
  clicks: number;
  sessions: number;
}

/**
 * One non-funnel event, counted. The funnel table can only show the nine
 * ordered steps, so without this the side events are recorded, forwarded to
 * Mixpanel, and invisible in the app's own dashboard — which is where somebody
 * looks first. `round_skipped` and `host_claimed` in particular are worth
 * seeing next to the funnel, because they say why the funnel has a hole.
 */
export interface SideRow {
  name: string;
  sessions: number;
  events: number;
}

export interface AnalyticsSummary {
  period: Period;
  sessions: number;
  events: number;
  funnel: FunnelRow[];
  /** The allowlisted non-funnel events, busiest first. */
  side: SideRow[];
  /** Sessions that opened the app and never locked a guess, as a percentage. */
  dropoutRate: number | null;
  medianSessionSeconds: number | null;
  clicks: ClickRow[];
  rooms: Array<{ room_code: string; joined: number; played: number; last_seen: string }>;
  /** True when the batch hit the row cap, so the numbers are a sample. */
  truncated: boolean;
}

interface RawRow {
  session_id: string;
  name: string;
  room_code: string | null;
  path: string | null;
  props: Record<string, unknown> | null;
  ts: string;
}

export async function summary(period: Period): Promise<AnalyticsSummary> {
  let q = admin()
    .from("analytics_events")
    .select("session_id, name, room_code, path, props, ts")
    .order("ts", { ascending: false })
    .limit(MAX_ROWS);

  const from = since(period);
  if (from) q = q.gte("ts", from);

  const { data, error } = await q;
  if (error) {
    throw new ApiError(
      500,
      /does not exist/i.test(error.message)
        ? "analytics_events is missing — run supabase/schema.sql"
        : error.message
    );
  }

  return foldEvents((data ?? []) as RawRow[], period);
}

/**
 * The whole report, as a pure function of the rows. Kept separate from the
 * query for the same reason `foldPlayerRows` is: this is where the numbers are
 * decided, so this is the part worth testing.
 */
export function foldEvents(rows: RawRow[], period: Period): AnalyticsSummary {
  const sessions = new Set<string>();
  const stepSessions = new Map<string, Set<string>>();
  const stepEvents = new Map<string, number>();
  const clicks = new Map<string, ClickRow>();
  const durations: number[] = [];
  const rooms = new Map<string, { joined: Set<string>; played: Set<string>; last: string }>();

  for (const row of rows) {
    sessions.add(row.session_id);
    stepEvents.set(row.name, (stepEvents.get(row.name) ?? 0) + 1);

    let set = stepSessions.get(row.name);
    if (!set) stepSessions.set(row.name, (set = new Set()));
    set.add(row.session_id);

    if (row.name === "click") {
      const target = String(row.props?.target ?? "(unlabelled)");
      const key = `${target} ${row.path ?? ""}`;
      let entry = clicks.get(key);
      if (!entry) clicks.set(key, (entry = { target, path: row.path, clicks: 0, sessions: 0 }));
      entry.clicks += 1;
    }

    if (row.name === "session_end") {
      const seconds = Number(row.props?.seconds);
      if (Number.isFinite(seconds) && seconds >= 0 && seconds < 86400) durations.push(seconds);
    }

    if (row.room_code && (row.name === "joined" || row.name === "guess_locked")) {
      let entry = rooms.get(row.room_code);
      if (!entry) {
        // Rows arrive newest first, so the first `ts` seen is the latest one.
        rooms.set(row.room_code, (entry = { joined: new Set(), played: new Set(), last: row.ts }));
      }
      if (row.name === "joined") entry.joined.add(row.session_id);
      else entry.played.add(row.session_id);
    }
  }

  // Distinct sessions per click target need a second pass over the same rows,
  // which is cheap and keeps the first pass readable.
  const clickSessions = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.name !== "click") continue;
    const key = `${String(row.props?.target ?? "(unlabelled)")} ${row.path ?? ""}`;
    let set = clickSessions.get(key);
    if (!set) clickSessions.set(key, (set = new Set()));
    set.add(row.session_id);
  }
  for (const [key, set] of clickSessions) {
    const entry = clicks.get(key);
    if (entry) entry.sessions = set.size;
  }

  const first = stepSessions.get(FUNNEL[0])?.size ?? 0;
  const funnel: FunnelRow[] = FUNNEL.map((step, i) => {
    const count = stepSessions.get(step)?.size ?? 0;
    const prev = i === 0 ? count : stepSessions.get(FUNNEL[i - 1])?.size ?? 0;
    return {
      step,
      sessions: count,
      events: stepEvents.get(step) ?? 0,
      conversion: first > 0 ? round1((100 * count) / first) : null,
      dropoff: i === 0 || prev === 0 ? null : round1((100 * Math.max(prev - count, 0)) / prev),
    };
  });

  const opened = stepSessions.get("app_open")?.size ?? 0;
  const played = stepSessions.get("guess_locked")?.size ?? 0;
  const dropoutRate = opened > 0 ? round1((100 * Math.max(opened - played, 0)) / opened) : null;

  // `click` and `pointer_heat` are left out: the clicks table below is a better
  // view of the first, and the second is a payload rather than a count.
  const side: SideRow[] = SIDE_EVENTS.filter((n) => n !== "click" && n !== "pointer_heat")
    .map((name) => ({
      name,
      sessions: stepSessions.get(name)?.size ?? 0,
      events: stepEvents.get(name) ?? 0,
    }))
    .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));

  return {
    period,
    sessions: sessions.size,
    events: rows.length,
    funnel,
    side,
    dropoutRate,
    medianSessionSeconds: median(durations),
    clicks: [...clicks.values()].sort((a, b) => b.clicks - a.clicks).slice(0, 25),
    rooms: [...rooms.entries()]
      .map(([room_code, v]) => ({
        room_code,
        joined: v.joined.size,
        played: v.played.size,
        last_seen: v.last,
      }))
      .sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1))
      .slice(0, 25),
    truncated: rows.length >= MAX_ROWS,
  };
}

// ---------------------------------------------------------------------
// Input clamping
// ---------------------------------------------------------------------

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

function roomCode(value: unknown): string | null {
  const raw = str(value, 8);
  return raw && /^[A-Za-z0-9]{4,8}$/.test(raw) ? raw.toUpperCase() : null;
}

function timestamp(value: unknown): string {
  const ms = Number(value);
  // Events are queued client-side and flushed later, so they carry their own
  // timestamp — but a clock that is wrong or hostile does not get to write it.
  if (!Number.isFinite(ms)) return new Date().toISOString();
  const now = Date.now();
  if (ms > now + 60000 || ms < now - 86400000) return new Date().toISOString();
  return new Date(ms).toISOString();
}

function cleanProps(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROP_KEYS) break;
    if (!/^[a-z][a-z0-9_]{0,23}$/i.test(key)) continue;
    if (typeof raw === "string") {
      const v = raw.slice(0, MAX_STR);
      if (v) out[key] = v;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = Math.round(raw * 1000) / 1000;
    } else if (typeof raw === "boolean") {
      out[key] = raw;
    }
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return round1(value);
}
