/**
 * Mixpanel mirror.
 *
 * The app already records every event into its own `analytics_events` table.
 * This module copies those same rows to Mixpanel so the funnel, retention and
 * breakdown reports there work on real data. Supabase stays the source of
 * truth; Mixpanel is a second reader, not a replacement.
 *
 * Why the forward happens on the server rather than in the browser:
 *
 *   - One instrumentation. Every `track()` call in the app is already routed
 *     through POST /api/events, so nothing needs re-labelling for Mixpanel.
 *   - Ad blockers. A large share of browsers drop requests to Mixpanel's
 *     domain outright; a request to our own /api/events is never blocked, so
 *     the numbers stop being quietly wrong.
 *   - Nothing extra ships to the phone. The browser SDK is ~30 KB of
 *     JavaScript, on a game people open on mobile data.
 *
 * The one thing this cannot do is Session Replay, which needs the browser SDK
 * to record the DOM. See the README if that becomes worth the trade.
 *
 * A failure here is logged and dropped. Mixpanel being down, rate-limiting, or
 * misconfigured must never affect a game or the app's own analytics.
 */

import { createHash } from "node:crypto";
import type { EventRow } from "./analytics";

/**
 * EU data residency. The project lives on eu.mixpanel.com, and events sent to
 * the US host land in a different project entirely — silently, with a 200 back.
 * This is the single most common reason a correct-looking integration shows no
 * data, so the host is pinned here rather than left to a default.
 */
const DEFAULT_HOST = "https://api-eu.mixpanel.com";

const TIMEOUT_MS = 2500;

/** Mixpanel caps /track at 2000 events; our batches are 40 at most. */
const MAX_PER_REQUEST = 500;

export interface MixpanelEvent {
  event: string;
  properties: Record<string, string | number | boolean>;
}

function token(): string | null {
  const raw = process.env.MIXPANEL_TOKEN?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function host(): string {
  return (process.env.MIXPANEL_HOST?.trim() || DEFAULT_HOST).replace(/\/+$/, "");
}

/** True when a token is configured, i.e. the mirror is live. */
export function mixpanelEnabled(): boolean {
  return token() !== null;
}

/**
 * Maps our rows onto Mixpanel's wire format. Pure, and therefore the part
 * under test — a mirror that mislabels events is worse than no mirror.
 */
export function toMixpanel(rows: EventRow[], apiToken: string): MixpanelEvent[] {
  return rows.map((row) => {
    const ms = Date.parse(row.ts);
    const time = Number.isFinite(ms) ? ms : Date.now();

    // The same person on the same device is one distinct_id across games,
    // which is what makes Mixpanel's funnels and retention meaningful. With no
    // device id (a browser that cannot keep storage) the tab is the best we
    // have, and it is prefixed so the two kinds can never collide.
    const distinct = row.player_uid ?? `session-${row.session_id}`;

    const properties: Record<string, string | number | boolean> = {
      token: apiToken,
      distinct_id: distinct,
      // Simplified ID merge treats this as an anonymous device rather than a
      // signed-in user, which is exactly what it is: there are no accounts.
      $device_id: distinct,
      $insert_id: insertId(row),
      time,
      // No geolocation. We never collect the player's IP, so letting Mixpanel
      // resolve one from our server would invent a location for everybody.
      ip: "0",
      session_id: row.session_id,
      source: "consensus-radar",
      ...stringifyProps(row.props),
    };

    if (row.path) properties.path = row.path;
    if (row.room_code) properties.room_code = row.room_code;
    if (row.lang) properties.lang = row.lang;
    // Not `$device`, which Mixpanel owns and parses from a user agent we never send.
    if (row.device) properties.device_type = row.device;

    return { event: row.name, properties };
  });
}

/**
 * A stable id per event so a retry cannot double-count. Mixpanel de-duplicates
 * on `$insert_id` for five days, and our client re-sends a batch it could not
 * confirm, so this is what keeps a flaky connection from inflating the funnel.
 */
function insertId(row: EventRow): string {
  const seed = [row.session_id, row.name, row.ts, row.path ?? "", JSON.stringify(row.props)].join("|");
  return createHash("sha1").update(seed).digest("hex").slice(0, 32);
}

/** Mixpanel takes flat scalars; anything else is dropped upstream already. */
function stringifyProps(props: Record<string, string | number | boolean>) {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    // `token`, `time` and friends are ours to set; a prop named `token` from a
    // stale client must not be able to redirect the batch to another project.
    if (RESERVED.has(key)) continue;
    out[key] = value;
  }
  return out;
}

const RESERVED = new Set([
  "token",
  "distinct_id",
  "time",
  "ip",
  "$insert_id",
  "$device_id",
  "$user_id",
  "session_id",
  "source",
]);

/**
 * Sends a batch. Never throws: callers are ingest paths that must answer the
 * browser regardless of what Mixpanel does.
 */
export async function forward(rows: EventRow[]): Promise<{ sent: number }> {
  const apiToken = token();
  if (!apiToken || rows.length === 0) return { sent: 0 };

  let sent = 0;
  for (let i = 0; i < rows.length; i += MAX_PER_REQUEST) {
    const slice = rows.slice(i, i + MAX_PER_REQUEST);
    if (await post(toMixpanel(slice, apiToken))) sent += slice.length;
  }
  return { sent };
}

async function post(events: MixpanelEvent[]): Promise<boolean> {
  try {
    // verbose=1 turns a bare "0" into a JSON reason, which is the difference
    // between a debuggable failure and a mystery.
    const res = await fetch(`${host()}/track?verbose=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const body = (await res.json().catch(() => null)) as { status?: number; error?: string } | null;
    if (!res.ok || body?.status !== 1) {
      console.warn(
        `[mixpanel] rejected ${events.length} event(s): ${res.status} ${body?.error ?? ""}`.trim()
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[mixpanel] send failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
