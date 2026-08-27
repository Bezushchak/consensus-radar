"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import type { AnalyticsSummary, Period } from "@/lib/server/analytics";

/**
 * The internal dashboard. Deliberately English-only and deliberately plain:
 * nobody plays on this page, and a chart library would be the heaviest
 * dependency in the project for something bar divs already say.
 *
 * The read token, when one is set, arrives as ?key=… in the URL and is read
 * from `window.location` rather than `useSearchParams` so the page stays a
 * plain client component with no Suspense boundary.
 */

const PERIODS: Array<[Period, string]> = [
  ["day", "24 hours"],
  ["week", "7 days"],
  ["month", "30 days"],
  ["all", "All time"],
];

const STEP_LABELS: Record<string, string> = {
  app_open: "Opened the app",
  create_open: "Started the create form",
  room_created: "Created a room",
  joined: "Joined a room",
  game_started: "Started the game",
  clue_sent: "Sent a clue",
  guess_locked: "Locked a guess",
  round_revealed: "Completed a round",
  game_finished: "Finished a game",
};

/**
 * Everything the app records that is not a funnel step. Plain English rather
 * than the event name, because the two that matter — the rescue hatches — are
 * only interesting next to a step, and a reader should not have to know the
 * codebase to see which those are.
 *
 * `click` and `pointer_heat` are excluded upstream in `foldEvents`, so they
 * deliberately have no entry here.
 */
const SIDE_LABELS: Record<string, string> = {
  join_open: "Opened the join form",
  leaderboard_open: "Opened the leaderboard",
  howto_open: "Opened how-to-play",
  lang_switched: "Switched language",
  bet_placed: "Placed a bet on the other team",
  round_skipped: "Gave up on a round — nothing scored",
  host_claimed: "Took over from a host who went quiet",
  error_shown: "Saw an error message",
  session_end: "Left (last event of a session)",
};

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [key, setKey] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("key");
    setKey(fromUrl && fromUrl.length > 0 ? fromUrl : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics?period=${period}`, {
        cache: "no-store",
        headers: key ? { "x-analytics-key": key } : undefined,
      });
      const body = (await res.json()) as AnalyticsSummary & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, key]);

  useEffect(() => {
    void load();
  }, [load]);

  const top = data?.funnel[0]?.sessions ?? 0;

  return (
    <div className="wrap wide">
      <AppHeader nav="home" />

      <section className="card">
        <h2>📈 Analytics</h2>
        <p className="sub">
          Sessions, conversion and drop-off, from the events the app records itself. A session is
          one browser tab; no accounts, no IP addresses, no cursor trails.
        </p>

        <div className="tabs">
          {PERIODS.map(([value, label]) => (
            <button
              key={value}
              className={period === value ? "active" : ""}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <div className="err">{error}</div> : null}

        {loading ? (
          <p className="empty">
            <span className="spin" />
            Loading…
          </p>
        ) : !data ? null : (
          <>
            <div className="kpis">
              <div className="kpi">
                <div className="kpinum">{data.sessions}</div>
                <div className="kpilabel">Sessions</div>
              </div>
              <div className="kpi">
                <div className="kpinum">{data.events}</div>
                <div className="kpilabel">Events</div>
              </div>
              <div className="kpi">
                <div className="kpinum">
                  {data.dropoutRate === null ? "—" : `${data.dropoutRate}%`}
                </div>
                <div className="kpilabel">Drop-out (opened, never played)</div>
              </div>
              <div className="kpi">
                <div className="kpinum">
                  {data.medianSessionSeconds === null
                    ? "—"
                    : `${Math.round(data.medianSessionSeconds)}s`}
                </div>
                <div className="kpilabel">Median session</div>
              </div>
            </div>

            {data.truncated ? (
              <p className="stepnote">
                ⚠️ The row cap was hit, so these numbers are a sample of the newest events. Narrow
                the period for exact counts.
              </p>
            ) : null}

            <h3 style={{ marginTop: 26 }}>Funnel</h3>
            <div className="tablewrap">
              <table className="lb">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Step</th>
                    <th>Sessions</th>
                    <th>Conversion</th>
                    <th>Drop-off</th>
                    <th>Events</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.funnel.map((row, i) => (
                    <tr key={row.step}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        {STEP_LABELS[row.step] ?? row.step}
                        <div className="mini">{row.step}</div>
                      </td>
                      <td className="num">{row.sessions}</td>
                      <td className="num">
                        {row.conversion === null ? "—" : `${row.conversion}%`}
                      </td>
                      <td className="num">
                        {row.dropoff === null ? "—" : `${row.dropoff}%`}
                      </td>
                      <td className="num">{row.events}</td>
                      <td style={{ width: "28%", minWidth: 120 }}>
                        <div className="bar">
                          <span
                            style={{
                              width: `${top > 0 ? Math.round((100 * row.sessions) / top) : 0}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="stepnote">
              Conversion is the share of step 1. Drop-off is the share of the previous step that
              never arrived — the biggest number in that column is where to look first.
            </p>

            {/* Not steps, so they cannot appear above — but two of them are the
                reason a step underperforms, which is why they get their own
                table rather than living only in Mixpanel. */}
            <h3 style={{ marginTop: 26 }}>Other events</h3>
            {/* `side` is read defensively: a tab left open across a deploy can
                hold an older response that has no such field, and the guard is
                what stops the `.map` below running on undefined. */}
            {(data.side?.every((r) => r.events === 0) ?? true) ? (
              <p className="empty">Nothing recorded yet.</p>
            ) : (
              <div className="tablewrap">
                <table className="lb">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>What it means</th>
                      <th>Sessions</th>
                      <th>Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.side.map((row) => (
                      <tr key={row.name}>
                        <td className="mini">{row.name}</td>
                        <td>{SIDE_LABELS[row.name] ?? "—"}</td>
                        <td className="num">{row.sessions}</td>
                        <td className="num">{row.events}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="stepnote">
              <code>round_skipped</code> against <code>round_revealed</code> is how often a scale or
              a clue-giver defeats a table; <code>host_claimed</code> against{" "}
              <code>room_created</code> is how often the person who opened the room walked away from
              it. If either climbs, the fix is upstream of the button.
            </p>

            <h3 style={{ marginTop: 26 }}>What people click</h3>
            {data.clicks.length === 0 ? (
              <p className="empty">No clicks recorded yet.</p>
            ) : (
              <div className="tablewrap">
                <table className="lb">
                  <thead>
                    <tr>
                      <th className="rank">#</th>
                      <th>Control</th>
                      <th>Page</th>
                      <th>Clicks</th>
                      <th>Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clicks.map((row, i) => (
                      <tr key={`${row.target}-${row.path}-${i}`}>
                        <td className="rank">{i + 1}</td>
                        <td>{row.target}</td>
                        <td className="mini">{row.path ?? "—"}</td>
                        <td className="num">{row.clicks}</td>
                        <td className="num">{row.sessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 style={{ marginTop: 26 }}>Rooms</h3>
            {data.rooms.length === 0 ? (
              <p className="empty">No rooms in this period.</p>
            ) : (
              <div className="tablewrap">
                <table className="lb">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Joined</th>
                      <th>Played</th>
                      <th>Reached play</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rooms.map((row) => (
                      <tr key={row.room_code}>
                        <td>{row.room_code}</td>
                        <td className="num">{row.joined}</td>
                        <td className="num">{row.played}</td>
                        <td className="num">
                          {row.joined > 0
                            ? `${Math.round((100 * row.played) / row.joined)}%`
                            : "—"}
                        </td>
                        <td className="mini">
                          {new Date(row.last_seen).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <div className="footer">
        <Link href="/">Home</Link> · <Link href="/leaderboard">Leaderboard</Link>
      </div>
    </div>
  );
}
