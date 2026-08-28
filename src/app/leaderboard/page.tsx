"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import EntryDetail from "@/components/leaderboard/EntryDetail";
import Podium from "@/components/leaderboard/Podium";
import type { LbEntry } from "@/components/leaderboard/types";
import { fetchLeaderboard } from "@/lib/client/api";
import { deviceUid } from "@/lib/client/identity";
import { playerTag } from "@/lib/player-tag";
import { startTracking, track, trackOnce } from "@/lib/client/track";
import { storedLabels } from "@/lib/scales";

type Board = "teams" | "rounds" | "players" | "scales";
type Period = "all" | "month" | "week";

type Row = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
const n = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

/** 0..100 or nothing — the dial cannot be drawn from a half-known round. */
const pct = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 && x <= 100 ? x : null;
};

/** The three that go on the podium; the table starts after them. */
const PODIUM = 3;

export default function LeaderboardPage() {
  const { t, lang } = useLang();
  const [board, setBoard] = useState<Board>("teams");
  const [period, setPeriod] = useState<Period>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<LbEntry | null>(null);

  // This browser's own tag, so it can find itself in the table. Computed here
  // rather than sent by the server: the server never learns which row belongs
  // to whoever is looking, and the answer is the same hash either way.
  // localStorage is not available during the server render, hence the effect.
  const [myTag, setMyTag] = useState<string | null>(null);
  useEffect(() => {
    setMyTag(playerTag(deviceUid()));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLeaderboard(board, period, 50);
      setRows(res.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the leaderboard");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [board, period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    startTracking();
    trackOnce("leaderboard_open");
  }, []);

  // Switching board or period reshuffles the ranks, so an open card would be
  // describing a row that is no longer where it was.
  useEffect(() => {
    setPicked(null);
  }, [board, period]);

  // Rows carry both languages; older rows only have the English pair.
  const poleParts = useCallback(
    (r: Row) =>
      storedLabels(
        {
          scale_left: s(r.scale_left),
          scale_right: s(r.scale_right),
          scale_left_ua: (r.scale_left_ua as string | null) ?? null,
          scale_right_ua: (r.scale_right_ua as string | null) ?? null,
        },
        lang
      ),
    [lang]
  );

  const poles = useCallback(
    (r: Row) => {
      const { left, right } = poleParts(r);
      return `${left} ↔ ${right}`;
    },
    [poleParts]
  );

  const when = useCallback(
    (iso: unknown) => {
      if (!iso) return "—";
      const d = new Date(String(iso));
      return d.toLocaleDateString(lang === "ua" ? "uk-UA" : "en-GB", {
        day: "2-digit",
        month: "short",
      });
    },
    [lang]
  );

  /**
   * Every board flattened into the one shape the podium and the detail card
   * read. Done here rather than on the server because half of it is wording:
   * the stat labels, the language the poles are shown in, and which row belongs
   * to this device are all decided in the browser.
   */
  const entries = useMemo<LbEntry[]>(() => {
    if (board === "teams") {
      return rows.map((r, i) => ({
        key: `${r.room_code}-${r.team_name}-${i}`,
        rank: i + 1,
        title: s(r.team_name),
        subtitle: `${s(r.room_code)} · ${when(r.finished_at)}`,
        headline: n(r.score),
        headlineLabel: t("pts"),
        crown: Boolean(r.is_winner),
        stats: [
          { label: t("colRounds"), value: n(r.rounds_played) },
          { label: t("colAvgDist"), value: n(r.avg_distance), hint: t("lbLowerBetter") },
          {
            label: t("colPlayers"),
            value: Array.isArray(r.players) ? String((r.players as string[]).length) : "—",
            hint: Array.isArray(r.players) ? (r.players as string[]).join(", ") : null,
          },
          { label: t("colWhen"), value: when(r.finished_at) },
        ],
      }));
    }

    if (board === "rounds") {
      return rows.map((r, i) => {
        const target = pct(r.target);
        const marker = pct(r.marker);
        const { left, right } = poleParts(r);
        return {
          key: `${r.revealed_at}-${i}`,
          rank: i + 1,
          title: s(r.clue),
          subtitle: poles(r),
          headline: n(r.distance),
          headlineLabel: t("colMiss"),
          face: "🎯",
          dial: target !== null && marker !== null ? { target, marker } : null,
          poles: { left, right },
          stats: [
            { label: t("colScore"), value: n(r.points) },
            { label: t("colTeam"), value: s(r.team_name) },
            { label: t("colPlayer"), value: s(r.clue_giver_name) },
            { label: t("colWhen"), value: when(r.revealed_at) },
          ],
        };
      });
    }

    if (board === "players") {
      return rows.map((r, i) => {
        const tag = (r.player_tag as string | null) ?? null;
        const mine = tag !== null && tag === myTag;
        return {
          key: `${r.player_name}-${tag ?? i}`,
          rank: i + 1,
          title: s(r.player_name),
          subtitle: tag && (r.ambiguous || mine) ? tag : null,
          headline: n(r.clue_avg_points),
          headlineLabel: t("colCluePts"),
          mine,
          stats: [
            { label: t("colClues"), value: n(r.clues_given) },
            { label: t("colGuessDist"), value: n(r.guess_avg_distance), hint: t("lbLowerBetter") },
            { label: t("colGuesses"), value: n(r.guesses_made) },
            { label: t("colBets"), value: n(r.bets_won) },
            { label: t("colScore"), value: n(r.total_points) },
          ],
        };
      });
    }

    return rows.map((r, i) => ({
      key: `${r.scale_key}-${i}`,
      rank: i + 1,
      title: poles(r),
      subtitle: s(r.scale_key),
      headline: n(r.avg_distance),
      headlineLabel: t("colAvgDist"),
      face: "📈",
      stats: [
        { label: t("colCluePts"), value: n(r.avg_points) },
        { label: t("colBullseyes"), value: n(r.bullseyes) },
        { label: t("colTimes"), value: n(r.times_played) },
      ],
    }));
  }, [board, rows, myTag, t, when, poles, poleParts]);

  const open = useCallback(
    (entry: LbEntry) => {
      setPicked(entry);
      track("lb_row_open", { board, rank: entry.rank });
    },
    [board]
  );

  // Stable, because the sheet's effect depends on it: a fresh closure every
  // render would tear down and rebuild the Escape listener and re-grab focus on
  // every re-render of this page.
  const close = useCallback(() => setPicked(null), []);

  /**
   * Rows four and down, paired with the raw row they came from. The first three
   * are on the podium, and repeating them in the table immediately underneath
   * reads as a bug rather than as emphasis.
   *
   * `entries` is built by mapping `rows` in order, so entry i and row i are the
   * same thing seen twice; pairing them here rather than looking one up by key
   * is what keeps that guarantee visible.
   */
  const rest = useMemo(
    () => entries.slice(PODIUM).map((entry, i) => ({ entry, row: rows[i + PODIUM] ?? {} })),
    [entries, rows]
  );

  // One clickable row, so the four tables cannot drift apart on the parts that
  // are not about columns: the handler, the analytics label, the keyboard.
  const rowProps = (e: LbEntry) => ({
    className: `clickable${e.mine ? " mine" : ""}`,
    onClick: () => open(e),
    tabIndex: 0,
    role: "button" as const,
    "aria-label": `${e.rank}. ${e.title}`,
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open(e);
      }
    },
  });

  return (
    <div className="wrap wide">
      <AppHeader nav="home" />

      <section className="card">
        <h2>🏆 {t("lbTitle")}</h2>
        <p className="sub">{t("lbSub")}</p>

        <div className="tabs">
          {(
            [
              ["teams", t("lbTeams")],
              ["rounds", t("lbRounds")],
              ["players", t("lbPlayers")],
              ["scales", t("lbScales")],
            ] as [Board, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={board === key ? "active" : ""}
              data-ev={`lb-board-${key}`}
              onClick={() => setBoard(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tabs">
          {(
            [
              ["all", t("periodAll")],
              ["month", t("periodMonth")],
              ["week", t("periodWeek")],
            ] as [Period, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={period === key ? "active" : ""}
              data-ev={`lb-period-${key}`}
              onClick={() => setPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <div className="err">{error}</div> : null}

        {loading ? (
          <p className="empty">
            <span className="spin" />
            {t("loading")}
          </p>
        ) : entries.length === 0 ? (
          <p className="empty">{t("lbEmpty")}</p>
        ) : (
          <>
            <Podium
              entries={entries}
              onPick={open}
              hint={t("lbTapHint")}
              youLabel={t("lbYou")}
            />

            {rest.length > 0 ? (
              <div className="tablewrap">
                {board === "teams" ? (
                  <table className="lb">
                    <thead>
                      <tr>
                        <th className="rank">#</th>
                        <th>{t("colTeam")}</th>
                        <th>{t("colScore")}</th>
                        <th>{t("colRounds")}</th>
                        <th>{t("colAvgDist")}</th>
                        <th>{t("colPlayers")}</th>
                        <th>{t("colWhen")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rest.map(({ entry: e, row: r }) => {
                        return (
                          <tr key={e.key} {...rowProps(e)}>
                            <td className="rank">{e.rank}</td>
                            <td>
                              {s(r.team_name)} {r.is_winner ? "👑" : ""}
                              <div className="mini">{s(r.room_code)}</div>
                            </td>
                            <td className="num">{n(r.score)}</td>
                            <td className="num">{n(r.rounds_played)}</td>
                            <td className="num">{n(r.avg_distance)}</td>
                            <td className="mini">
                              {Array.isArray(r.players)
                                ? (r.players as string[]).join(", ")
                                : "—"}
                            </td>
                            <td className="mini">{when(r.finished_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}

                {board === "rounds" ? (
                  <table className="lb">
                    <thead>
                      <tr>
                        <th className="rank">#</th>
                        <th>{t("colMiss")}</th>
                        <th>{t("colScale")}</th>
                        <th>{t("colClue")}</th>
                        <th>{t("colTeam")}</th>
                        <th>{t("colPlayer")}</th>
                        <th>{t("colWhen")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rest.map(({ entry: e, row: r }) => {
                        return (
                          <tr key={e.key} {...rowProps(e)}>
                            <td className="rank">{e.rank}</td>
                            <td className="num">
                              {n(r.distance)}
                              <div className="mini">
                                {n(r.marker)}% → {n(r.target)}%
                              </div>
                            </td>
                            <td className="mini">{poles(r)}</td>
                            <td>{s(r.clue)}</td>
                            <td>{s(r.team_name)}</td>
                            <td>{s(r.clue_giver_name)}</td>
                            <td className="mini">{when(r.revealed_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}

                {board === "players" ? (
                  <table className="lb">
                    <thead>
                      <tr>
                        <th className="rank">#</th>
                        <th>{t("colPlayer")}</th>
                        <th>{t("colCluePts")}</th>
                        <th>{t("colClues")}</th>
                        <th>{t("colGuessDist")}</th>
                        <th>{t("colGuesses")}</th>
                        <th>{t("colBets")}</th>
                        <th>{t("colScore")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rest.map(({ entry: e, row: r }) => {
                        const tag = (r.player_tag as string | null) ?? null;
                        const mine = Boolean(e.mine);
                        return (
                          <tr key={e.key} {...rowProps(e)}>
                            <td className="rank">{e.rank}</td>
                            <td>
                              {s(r.player_name)}
                              {/* The tag earns its space only when the name is
                                  shared, or when it is how you spot yourself. */}
                              {tag && (r.ambiguous || mine) ? (
                                <span className="mini"> · {tag}</span>
                              ) : null}
                              {mine ? <span className="mini"> · {t("lbYou")}</span> : null}
                            </td>
                            <td className="num">{n(r.clue_avg_points)}</td>
                            <td className="num">{n(r.clues_given)}</td>
                            <td className="num">{n(r.guess_avg_distance)}</td>
                            <td className="num">{n(r.guesses_made)}</td>
                            <td className="num">{n(r.bets_won)}</td>
                            <td className="num">{n(r.total_points)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}

                {board === "scales" ? (
                  <table className="lb">
                    <thead>
                      <tr>
                        <th className="rank">#</th>
                        <th>{t("colScale")}</th>
                        <th>{t("colAvgDist")}</th>
                        <th>{t("colCluePts")}</th>
                        <th>{t("colBullseyes")}</th>
                        <th>{t("colTimes")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rest.map(({ entry: e, row: r }) => {
                        return (
                          <tr key={e.key} {...rowProps(e)}>
                            <td className="rank">{e.rank}</td>
                            <td>
                              {poles(r)}
                              <div className="mini">{s(r.scale_key)}</div>
                            </td>
                            <td className="num">{n(r.avg_distance)}</td>
                            <td className="num">{n(r.avg_points)}</td>
                            <td className="num">{n(r.bullseyes)}</td>
                            <td className="num">{n(r.times_played)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {board === "players" ? (
          <>
            <p className="stepnote">{t("lbHint")}</p>
            <p className="stepnote">{t("lbTagHint")}</p>
          </>
        ) : null}
      </section>

      <div className="footer">
        <Link href="/">{t("homeLink")}</Link>
      </div>

      {picked ? (
        <EntryDetail
          entry={picked}
          onClose={close}
          closeLabel={t("lbClose")}
          rankLabel={t("lbRankOf", { rank: picked.rank, total: entries.length })}
          youLabel={t("lbYou")}
          targetLabel={t("lbTargetWas")}
          markerLabel={t("lbMarkerWas")}
        />
      ) : null}
    </div>
  );
}
